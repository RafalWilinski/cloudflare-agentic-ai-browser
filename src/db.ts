import { drizzle } from "drizzle-orm/d1";
import { jobs } from "./schema";
import { eq } from "drizzle-orm";
import { ChatCompletionMessageParam } from "openai/resources";

export class Database {
  private db;

  constructor(private env: Env) {
    this.db = drizzle(this.env.DB);
  }

  async insertJob(goal: string, baseUrl: string) {
    const job = await this.db
      .insert(jobs)
      .values({
        goal,
        startingUrl: baseUrl,
        status: "running",
      })
      .returning({ id: jobs.id, createdAt: jobs.createdAt })
      .all();
    return job;
  }

  async updateJob(
    id: number,
    messages: ChatCompletionMessageParam[],
    logs: string[],
    updatedAt: string
  ) {
    await this.db
      .update(jobs)
      .set({
        messages: JSON.stringify(messages),
        log: logs.join("\n"),
        updatedAt,
      })
      .where(eq(jobs.id, id));
  }

  async finalizeJob(
    id: number,
    finalAnswer: string,
    messages: ChatCompletionMessageParam[],
    logs: string[],
    completedAt: string
  ) {
    await this.db.update(jobs).set({
      output: finalAnswer,
      status: "success",
      messages: JSON.stringify(messages),
      log: logs.join("\n"),
      completedAt,
    });
  }
}
