
class ApiService {
  private invokeUrl: string;
  private streamUrl: string;

  constructor() {
    this.invokeUrl = '/invoke';
    this.streamUrl = '/stream';
    console.log("API service initialized. Endpoints: /invoke, /stream. Ready to connect to FastAPI backend.");
  }

  /**
   * Sends a prompt to the FastAPI backend and returns the model's complete response.
   * @param prompt The user's input prompt.
   * @returns A promise that resolves to a string with the AI's response.
   */
  public async runQuery(prompt: string): Promise<string> {
    try {
      const response = await fetch(this.invokeUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          "input": { "prompt": prompt },
          "config": {},
          "kwargs": {}
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        const detail = errorData?.detail || `HTTP error! status: ${response.status}`;
        throw new Error(`The Force is disturbed. API request failed: ${detail}`);
      }

      const result = await response.json();
      const content = result?.output?.content;

      if (typeof content !== 'string') {
        throw new Error("Invalid response format from the AI. The 'output.content' field is missing or not a string.");
      }

      return content;

    } catch (error) {
      console.error("Failed to communicate with the supervisor model:", error);
      throw error;
    }
  }

  /**
   * Connects to the streaming endpoint and yields text chunks as they are received.
   * This implementation uses modern stream APIs for robust parsing.
   * @param prompt The user's input prompt.
   * @returns An async generator that yields objects containing the agent and their response.
   */
  public async * runQueryStream(prompt: string): AsyncGenerator<{ agent: string, response: string }> {
    const response = await fetch(this.streamUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
      },
      body: JSON.stringify({
        "input": { "prompt": prompt },
        "config": {},
        "kwargs": {}
      }),
    });

    if (!response.ok || !response.body) {
      const errorData = await response.json().catch(() => null);
      const detail = errorData?.detail || `HTTP error! status: ${response.status}`;
      throw new Error(`The Force is disturbed. API stream request failed: ${detail}`);
    }

    let buffer = '';
    const jsonTransformer = new TransformStream({
      transform(chunk, controller) {
        buffer += chunk;
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep the last, potentially incomplete line

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const jsonStr = line.substring(6).trim();
            if (jsonStr) {
              try {
                const parsed = JSON.parse(jsonStr);
                 if (parsed.agent && typeof parsed.agent === 'string' && parsed.response && typeof parsed.response === 'string') {
                    controller.enqueue(parsed);
                }
              } catch (e) {
                console.warn("Error parsing stream chunk, skipping:", jsonStr, e);
              }
            }
          }
        }
      },
      flush(controller) {
        // Process any remaining data in the buffer when the stream is closing
        if (buffer.startsWith('data: ')) {
          const jsonStr = buffer.substring(6).trim();
           if (jsonStr) {
              try {
                const parsed = JSON.parse(jsonStr);
                if (parsed.agent && typeof parsed.agent === 'string' && parsed.response && typeof parsed.response === 'string') {
                    controller.enqueue(parsed);
                }
              } catch (e) {
                console.warn("Error parsing final stream chunk:", jsonStr, e);
              }
            }
        }
      }
    });

    const stream = response.body
      .pipeThrough(new TextDecoderStream())
      .pipeThrough(jsonTransformer);
      
    const reader = stream.getReader();

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      yield value;
    }
  }
}

// The service is now a generic API service, but we keep the export name for minimal changes
export const geminiService = new ApiService();
