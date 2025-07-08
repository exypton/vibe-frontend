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
   * Connects to the streaming endpoint using XMLHttpRequest and yields text chunks as they are received.
   * This implementation is designed to be robust for environments where fetch streams may have issues.
   * @param prompt The user's input prompt.
   * @returns An async generator that yields objects containing the agent and their response.
   */
  public runQueryStream(prompt: string): AsyncGenerator<{ agent: string, response: string }> {
    const xhr = new XMLHttpRequest();

    type QueueItem = { value: { agent: string, response: string } } | { done: true } | { error: Error };
    const queue: QueueItem[] = [];
    
    // This function will resolve the promise that the consumer is awaiting.
    // It's nullable because there might not be a consumer waiting when an item arrives.
    let resolvePromise: (() => void) | null = null;
    
    // The promise that the consumer will await when the queue is empty.
    let promise = new Promise<void>(resolve => { resolvePromise = resolve; });

    // A helper to safely add an item to the queue and signal the consumer if it's waiting.
    const enqueueAndSignal = (item: QueueItem) => {
        queue.push(item);
        if (resolvePromise) {
            resolvePromise();
            resolvePromise = null; // The resolver has been used, nullify it.
        }
    }

    let buffer = '';
    let lastResponseLength = 0;

    const processBuffer = () => {
      const newText = xhr.responseText.substring(lastResponseLength);
      buffer += newText;
      lastResponseLength = xhr.responseText.length;

      // SSE messages are separated by double newlines.
      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const message = buffer.substring(0, boundary);
        buffer = buffer.substring(boundary + 2);

        const dataLine = message.split('\n').find(line => line.startsWith('data:'));
        if (dataLine) {
          const jsonStr = dataLine.substring(6).trim();
          if (jsonStr) {
            try {
              const parsed = JSON.parse(jsonStr);
              if (parsed.agent && typeof parsed.agent === 'string' && parsed.response && typeof parsed.response === 'string') {
                enqueueAndSignal({ value: parsed });
              }
            } catch (e) {
              console.warn("Error parsing JSON from stream chunk:", jsonStr, e);
            }
          }
        }
        boundary = buffer.indexOf('\n\n');
      }
    };

    xhr.open('POST', this.streamUrl, true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.setRequestHeader('Accept', 'text/event-stream');

    xhr.onprogress = processBuffer;

    xhr.onload = () => {
      processBuffer(); // Process any remaining data in the buffer
      enqueueAndSignal({ done: true });
    };

    xhr.onerror = () => {
      const err = new Error('The Force is disturbed. XHR request failed.');
      enqueueAndSignal({ error: err });
    };
    
    xhr.onabort = () => { // Handle cases where XHR is aborted externally.
      enqueueAndSignal({ done: true });
    }

    xhr.send(JSON.stringify({
      "input": { "prompt": prompt },
      "config": {},
      "kwargs": {}
    }));

    // We create a true async generator function. This will return an object that
    // correctly implements the AsyncGenerator interface, fixing the TypeScript error.
    async function* createGenerator(): AsyncGenerator<{ agent: string, response:string }> {
        try {
            while(true) {
                // If the queue is empty, wait for a signal that an item has arrived.
                while (queue.length === 0) {
                    await promise;
                    // After waking up, create a new promise for the next time we need to wait.
                    promise = new Promise<void>(resolve => { resolvePromise = resolve; });
                }

                // Dequeue and process the item.
                const item = queue.shift()!;
                if ('error' in item) {
                    throw item.error;
                }
                if ('done' in item) {
                    return; // The stream is finished, so we exit the generator.
                }
                yield item.value;
            }
        } finally {
            // The `finally` block is essential for cleanup. It executes when the generator
            // exits for any reason (completes, errors, or is cancelled by the consumer).
            // We ensure the XHR request is aborted to prevent leaks.
            if (xhr.readyState > 0 && xhr.readyState < 4) {
                xhr.abort();
            }
        }
    }

    return createGenerator();
  }
}

// The service is now a generic API service, but we keep the export name for minimal changes
export const geminiService = new ApiService();
