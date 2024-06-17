import { Page } from "@cloudflare/puppeteer";

export async function getCleanHtml(page: Page | string): Promise<string> {
  function removeScriptAndStyleTags(html: string): string {
    const scriptAndStyleTagsRegex = /<(script|style)\b[^<]*(?:(?!<\/\1>)<[^<]*)*<\/\1>/gi;
    return html.replace(scriptAndStyleTagsRegex, "");
  }

  function removeInlineEventHandlers(html: string): string {
    const eventHandlerRegex = /\s(on\w+)=["'].*?["']/gi;
    return html.replace(eventHandlerRegex, "");
  }

  function removeUnnecessaryAttributes(html: string): string {
    const unnecessaryAttributesRegex = /\s(type|language)=["'].*?["']/gi;
    return html.replace(unnecessaryAttributesRegex, "");
  }

  function removeComments(html: string): string {
    const commentRegex = /<!--[\s\S]*?-->/g;
    return html.replace(commentRegex, "");
  }

  function compressHtml(html: string): string {
    let compressedHtml = html.replace(/\n+/g, "");
    compressedHtml = compressedHtml.replace(/\s{2,}/g, " ");
    compressedHtml = compressedHtml.replace(/>\s+</g, "><");
    compressedHtml = compressedHtml.trim();
    return compressedHtml;
  }

  const rawHtml =
    typeof page === "string" ? page : await page.evaluate(() => (document as any).body.innerHTML);

  const cleanedHtml = [
    removeScriptAndStyleTags,
    removeInlineEventHandlers,
    removeUnnecessaryAttributes,
    removeComments,
    compressHtml,
  ].reduce((html, cleaningStep) => cleaningStep(html), rawHtml);

  return `[HTML]:\n${cleanedHtml}`;
}

/**
 * Accumulating multiple HTML pages in messages is a recipe for a disaster (context blowup).
 * This function removes all HTML tags from the messages except for the latest one.
 */
export function removeHtmlsFromMessages(
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
