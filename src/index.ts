import puppeteer, { Page } from "@cloudflare/puppeteer";
import OpenAI from "openai";
import { ChatCompletion, ChatCompletionMessageParam } from "openai/resources";
import { tools } from "./tools";
import { systemPrompt } from "./prompts";

const handler = {
  async fetch(request, env): Promise<Response> {
    let id = env.BROWSER.idFromName("browser");
    let obj = env.BROWSER.get(id);

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
    const data: { baseUrl?: string; goal?: string } = await request.json();
    const baseUrl = data.baseUrl ?? "https://bubble.io";
    const goal = data.goal ?? "Extract pricing model for this company";

    // use the current date and time to create a folder structure for R2
    const nowDate = new Date();
    var coeff = 1000 * 60 * 5;
    var roundedDate = new Date(Math.round(nowDate.getTime() / coeff) * coeff).toString();
    var folder =
      roundedDate.split(" GMT")[0] + "_" + baseUrl.replace("https://", "").replace("http://", "");

    //if there's a browser session open, re-use it
    if (!this.browser || !this.browser.isConnected()) {
      console.log(`Browser DO: Starting new instance`);
      try {
        this.browser = await puppeteer.launch(this.env.MYBROWSER);
      } catch (e) {
        console.log(`Browser DO: Could not start browser instance. Error: ${e}`);
      }
    }

    // Reset keptAlive after each call to the DO
    this.keptAliveInSeconds = 0;

    const page = await this.browser.newPage();
    await page.setViewport({ width, height });
    await page.goto(baseUrl);

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

      await this.storeScreenshot(page, folder);

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
        console.log(parsedArg.reasoning);

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

    return new Response(JSON.stringify(completion?.choices[0].message.content));
  }

  private async storeScreenshot(page: puppeteer.Page, folder: string) {
    const fileName = "screenshot_" + new Date().toISOString();

    const sc = await page.screenshot({ path: fileName + ".jpg" });
    await this.env.BUCKET.put(folder + "/" + fileName + ".jpg", sc);
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

/**
 * Remove scripts, duplicate spaces, return condensed HTML to minimize tokens usage
 */
async function getCleanHtml(page: Page | string): Promise<string> {
  function removeScriptTags(html: string): string {
    // Regular expression to match <script>...</script> tags
    const scriptTagRegex = /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi;

    // Replace the matched script tags with an empty string
    return html.replace(scriptTagRegex, "");
  }

  function compressHtml(html: string): string {
    // Remove newlines and leading/trailing whitespaces
    let compressedHtml = html.replace(/\n+/g, "");
    compressedHtml = compressedHtml.replace(/\s{2,}/g, " ");
    compressedHtml = compressedHtml.replace(/>\s+</g, "><");
    compressedHtml = compressedHtml.trim();
    return compressedHtml;
  }

  const htmlWithoutScripts = removeScriptTags(
    typeof page === "string" ? page : await page.evaluate(() => (document as any).body.innerHTML)
  );

  return `[HTML]:\n${compressHtml(htmlWithoutScripts)}`;
}

/**
 * Accumulating multiple HTML pages in messages is a recipe for a disaster (context blowup).
 * This function removes all HTML tags from the messages except for the latest one.
 */
function removeHtmlsFromMessages(
  messages: ChatCompletionMessageParam[]
): ChatCompletionMessageParam[] {
  let htmlIndex = -1;

  // Find the index of the latest HTML content
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].content && (messages[i].content as string).includes("[HTML]:")) {
      htmlIndex = i;
    }
  }

  // Map through messages and replace HTML content except for the latest one
  return messages.map((m, index) => {
    if (index !== htmlIndex && m.content && (m.content as string).includes("[HTML]:")) {
      return {
        ...m,
        content: "HTML content skipped for brevity.",
      };
    }
    return m;
  });
}
