import { ChatCompletionTool } from "openai/resources/chat";

export const tools: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "click",
      description:
        "Clicks selected element, wait until navigation/interaction ends and returns the resulting HTML",
      parameters: {
        type: "object",
        properties: {
          selector: {
            type: "string",
            description: "HTML selector of element to click",
          },
          reasoning: {
            type: "string",
            description: "Human readable explanation what and why is clicked for audit purposes",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "type",
      description: "Type text into an input field",
      parameters: {
        type: "object",
        properties: {
          selector: {
            type: "string",
            description: "HTML selector of element to click",
          },
          value: {
            type: "string",
            description: "value to fill",
          },
          reasoning: {
            type: "string",
            description: "Human readable explanation what and why is typed for audit purposes",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "select",
      description: "Select an option from a dropdown menu",
      parameters: {
        type: "object",
        properties: {
          selector: {
            type: "string",
            description: "HTML selector of element to click",
          },
          value: {
            type: "string",
            description: "option to select",
          },
          reasoning: {
            type: "string",
            description: "Human readable explanation what and why is selected for audit purposes",
          },
        },
      },
    },
  },
];
