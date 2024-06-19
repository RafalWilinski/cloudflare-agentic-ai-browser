import puppeteer from "@cloudflare/puppeteer";
import { drizzle } from "drizzle-orm/d1";
import OpenAI from "openai";
import { ChatCompletion, ChatCompletionMessageParam } from "openai/resources";
import { tools } from "./tools";
import { systemPrompt } from "./prompts";
import { getCleanHtml, removeHtmlsFromMessages } from "./utils";
import { jobs } from "./schema";
import { eq } from "drizzle-orm";

const handler = {
  async fetch(request, env): Promise<Response> {
    let id = env.BROWSER.idFromName("browser");
    let obj = env.BROWSER.get(id);

    const { success } = await env.RATE_LIMITER.limit({ key: "/" });
    if (!success) {
      return new Response(`429 Failure – rate limit exceeded`, { status: 429 });
    }

    if (request.method !== "POST") {
      return new Response("Please use POST request instead");
    }

    let resp = await obj.fetch(request);

    return resp;
  },
} satisfies ExportedHandler<Env>;

const width = 1920;
const height = 1080;
const KEEP_BROWSER_ALIVE_IN_SECONDS = 180;

export class Browser {
  private browser: puppeteer.Browser;
  private keptAliveInSeconds: number;
  private env: Env;
  private state: DurableObjectState;
  private storage: DurableObjectStorage;
  private openai: OpenAI;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
    this.keptAliveInSeconds = 0;
    this.storage = this.state.storage;
    this.openai = new OpenAI({
      apiKey: env.OPENAI_API_KEY,
      baseURL: `https://gateway.ai.cloudflare.com/v1/${env.ACCOUNT_ID}/agentic-browser-ai-gateway/openai`,
    });
  }

  async fetch(request: Request) {
    const logs: string[] = [];
    const startingTs: number = +new Date();

    const log = (msg: string) => {
      const elapsed = +new Date() - startingTs;
      const fullMsg = `[${elapsed}ms]: ${msg}`;
      logs.push(fullMsg);
      console.log(fullMsg);
    };

    const data: { baseUrl?: string; goal?: string } = await request.json();
    const baseUrl = data.baseUrl ?? "https://bubble.io";
    const goal = data.goal ?? "Extract pricing model for this company";

    const db = drizzle(this.env.DB);
    const job = await db
      .insert(jobs)
      .values({
        goal,
        startingUrl: baseUrl,
        status: "running",
      })
      .returning({ id: jobs.id, createdAt: jobs.createdAt })
      .all();
    const [{ id, createdAt }] = job;

    // use the current date and time to create a folder structure for R2
    const nowDate = new Date(createdAt);
    const coeff = 1000 * 60 * 5;
    const roundedDate = new Date(Math.round(nowDate.getTime() / coeff) * coeff).toString();
    const folder =
      roundedDate.split(" GMT")[0] + "_" + baseUrl.replace("https://", "").replace("http://", "");

    // If there's a browser session open, re-use it
    if (!this.browser || !this.browser.isConnected()) {
      log(`Browser DO: Starting new instance`);
      try {
        this.browser = await puppeteer.launch(this.env.MYBROWSER);
      } catch (e) {
        log(`Browser DO: Could not start browser instance. Error: ${e}`);
      }
    }

    // Reset keptAlive after each call to the DO
    this.keptAliveInSeconds = 0;

    const page = await this.browser.newPage();
    await page.setViewport({ width, height });
    await page.goto(baseUrl);

    log(`Loading page ${baseUrl}`);

    const messages: ChatCompletionMessageParam[] = [];
    messages.push({
      role: "system",
      content: systemPrompt,
    });
    messages.push({
      role: "user",
      content: `Goal: ${goal}\n${await getCleanHtml(page)}`,
    });

    let completion: ChatCompletion;

    do {
      const messagesSanitized = removeHtmlsFromMessages(messages);

      const r2Obj = await this.storeScreenshot(page, folder);
      log(`Stored screenshot at ${r2Obj.key}`);

      completion = await this.openai.chat.completions.create({
        model: "gpt-4o",
        messages: messagesSanitized,
        tools,
      });
      const newMessage = completion.choices[0].message;

      // Take just one. Hack to prevent parallel function calling
      if (newMessage.tool_calls && newMessage.tool_calls?.length > 0) {
        newMessage.tool_calls = [newMessage.tool_calls[0]];
      }

      messages.push(newMessage);

      const toolCalls = completion.choices[0].message.tool_calls || [];

      for (const toolCall of toolCalls) {
        const functionCall = toolCall.function;
        const arg = functionCall?.arguments;

        const parsedArg = JSON.parse(arg!);
        log(parsedArg.reasoning);

        await db
          .update(jobs)
          .set({
            messages: JSON.stringify(messages),
            log: logs.join("\n"),
            updatedAt: new Date().toISOString(),
          })
          .where(eq(jobs.id, id));

        try {
          switch (functionCall?.name) {
            case "click":
              await page.click(parsedArg.selector);
              break;
            case "type":
              await page.type(parsedArg.selector, parsedArg.value);
              break;
            case "select":
              await page.select(parsedArg.selector, parsedArg.value);
              break;
          }

          await page.waitForNavigation();

          messages.push({
            role: "tool",
            content: await getCleanHtml(page),
            tool_call_id: toolCall.id,
          });
        } catch (error) {
          messages.push({
            role: "tool",
            content: `Error: ${error.message}\n${await getCleanHtml(page)}`,
            tool_call_id: toolCall.id,
          });
        }
      }
    } while (!completion || completion?.choices[0].message.tool_calls?.[0]);

    const finalAnswer = completion?.choices[0].message.content;
    log(`Final Answer: ${finalAnswer}`);

    await db
      .update(jobs)
      .set({
        output: finalAnswer,
        status: "success",
        messages: JSON.stringify(messages),
        log: logs.join("\n"),
        completedAt: new Date().toISOString(),
      })
      .where(eq(jobs.id, id));

    // Close tab when there is no more work to be done on the page
    await page.close();

    // Reset keptAlive after performing tasks to the DO.
    this.keptAliveInSeconds = 0;

    // set the first alarm to keep DO alive
    let currentAlarm = await this.storage.getAlarm();
    if (currentAlarm == null) {
      console.log(`Browser DO: setting alarm`);
      const TEN_SECONDS = 10 * 1000;
      await this.storage.setAlarm(Date.now() + TEN_SECONDS);
    }

    return new Response(finalAnswer);
  }

  private async storeScreenshot(page: puppeteer.Page, folder: string) {
    const fileName = "screenshot_" + new Date().toISOString();

    const sc = await page.screenshot({ path: fileName + ".jpg" });
    return this.env.BUCKET.put(folder + "/" + fileName + ".jpg", sc);
  }

  async alarm() {
    this.keptAliveInSeconds += 10;

    // Extend browser DO life
    if (this.keptAliveInSeconds < KEEP_BROWSER_ALIVE_IN_SECONDS) {
      console.log(
        `Browser DO: has been kept alive for ${this.keptAliveInSeconds} seconds. Extending lifespan.`
      );
      await this.storage.setAlarm(Date.now() + 10 * 1000);
      // You could ensure the ws connection is kept alive by requesting something
      // or just let it close automatically when there  is no work to be done
      // for example, `await this.browser.version()`
    } else {
      console.log(`Browser DO: exceeded life of ${KEEP_BROWSER_ALIVE_IN_SECONDS}s.`);
      if (this.browser) {
        console.log(`Closing browser.`);
        await this.browser.close();
      }
    }
  }
}

export default handler;
