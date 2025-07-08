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
   * @param prompt The user's input prompt.
   * @returns An async generator that yields objects containing the agent and their response.
   */
  public async * runQueryStream(prompt: string): AsyncGenerator<{ agent: string, response: string }> {
    try {
      const response = await fetch(this.streamUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Correctly ask for a stream. text/event-stream is common for Server-Sent Events (SSE).
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
      
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          // If the stream ends and there's still data in the buffer, process it.
          if (buffer.length > 0) {
            const finalChunk = this.parseChunk(buffer);
            if (finalChunk) {
              yield finalChunk;
            }
          }
          break; // Exit the loop
        }

        // Add the new chunk of data to our buffer
        buffer += decoder.decode(value, { stream: true });

        // Process all complete messages in the buffer.
        // A complete message is expected to end with a newline.
        let newlineIndex;
        while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
          // Extract the full line (message)
          const line = buffer.slice(0, newlineIndex).trim();
          // Remove the processed line from the buffer
          buffer = buffer.slice(newlineIndex + 1);

          if (line) { // Ensure it's not an empty line
            const chunk = this.parseChunk(line);
            if (chunk) {
              yield chunk;
            }
          }
        }
      }
    } catch (error) {
      console.error("Failed to stream from supervisor model:", error);
      throw error;
    }
  }

  /**
   * Parses a single line from the stream into a structured object.
   * @param line A single line of text from the stream.
   * @returns A structured object or null if parsing fails or the line is empty.
   */
  private parseChunk(line: string): { agent: string, response: string } | null {
    // The server might be sending Server-Sent Events (SSE), which prefix messages with "data: ".
    if (line.startsWith('data: ')) {
      line = line.substring(6).trim(); // Remove "data: " and trim whitespace
    }

    // Ignore empty lines or special stream markers
    if (line.length === 0 || line === '[DONE]') {
      return null;
    }

    try {
      const parsed = JSON.parse(line);
      // Validate the expected structure of the JSON object
      if (parsed.agent && typeof parsed.agent === 'string' && parsed.response && typeof parsed.response === 'string') {
        return parsed;
      }
    } catch (e) {
      console.warn("Error parsing stream chunk, skipping:", line, e);
    }
    
    return null;
  }
}

// The service is now a generic API service, but we keep the export name for minimal changes
export const geminiService = new ApiService();
