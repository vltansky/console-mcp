import type {
  BrowserCommandResponse,
  DomSnapshotNode,
  LogMessage,
  ServerMessage,
} from 'console-bridge-shared';

interface ExecuteResultPayload {
  result?: unknown;
  error?: {
    message: string;
    stack?: string;
    name?: string;
  };
}

const CONSOLE_MCP_SOURCE = 'console-mcp';
const EXECUTE_SOURCE = 'console-mcp-execute';
const EXECUTE_TIMEOUT_MS = 30_000;
const executeCallbacks = new Map<
  string,
  { resolve: (payload: ExecuteResultPayload) => void; timer: number }
>();

// Listen for messages from the main world interceptor (console-interceptor-main.js)
window.addEventListener('message', (event) => {
  if (event.source !== window) return;

  const data = event.data;
  if (!data) return;

  if (data.source === CONSOLE_MCP_SOURCE && data.kind === 'console_log' && data.data) {
    const logData = data.data as LogMessage;
    chrome.runtime
      .sendMessage({
        type: 'console_log',
        data: logData,
      })
      .catch(() => {
        // Silently fail if background script is not available
      });
    return;
  }

  if (data.source === EXECUTE_SOURCE && data.kind === 'execute_js_result' && data.requestId) {
    const entry = executeCallbacks.get(data.requestId);
    if (entry) {
      clearTimeout(entry.timer);
      executeCallbacks.delete(data.requestId);
      entry.resolve(data.payload || {});
    }
  }
});

function injectExecuteScript(code: string, requestId: string): void {
  const script = document.createElement('script');
  const escapedCode = code.replace(/<\/script/gi, '<\\/script');
  script.textContent = `
    (async () => {
      const respond = (payload) => {
        window.postMessage({ source: '${EXECUTE_SOURCE}', kind: 'execute_js_result', requestId: ${JSON.stringify(requestId)}, payload }, '*');
      };
      try {
        const result = await (async () => { ${escapedCode} })();
        respond({ result });
      } catch (error) {
        respond({
          error: error instanceof Error
            ? { message: error.message, stack: error.stack, name: error.name }
            : { message: String(error) },
        });
      }
    })();
  `;
  (document.documentElement || document.head)?.appendChild(script);
  script.remove();
}

function executeInPage(code: string, requestId: string): Promise<ExecuteResultPayload> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      executeCallbacks.delete(requestId);
      resolve({ error: { message: 'Execution timed out', name: 'TimeoutError' } });
    }, EXECUTE_TIMEOUT_MS) as unknown as number;

    executeCallbacks.set(requestId, { resolve, timer });

    injectExecuteScript(code, requestId);
  });
}

// Register this tab with the background script immediately
// This ensures tabs appear in the list even before any logs are captured
chrome.runtime
  .sendMessage({
    type: 'tab_register',
    data: {
      url: window.location.href,
      title: document.title,
      sessionId: crypto.randomUUID(),
    },
  })
  .catch(() => {
    // Silently fail if background script is not available
  });

chrome.runtime.onMessage.addListener((message: ServerMessage, _sender, sendResponse) => {
  handleCommand(message)
    .then((response) => {
      sendResponse(response);
    })
    .catch((error) => {
      sendResponse({
        error: error instanceof Error ? error.message : String(error),
      });
    });

  // Return true to indicate async response
  return true;
});

async function handleCommand(message: ServerMessage): Promise<any> {
  switch (message.type) {
    case 'execute_js': {
      try {
        const payload = await executeInPage(message.data.code, message.data.requestId);

        const response: BrowserCommandResponse = {
          type: 'execute_js_response',
          data: {
            requestId: message.data.requestId,
            result: payload.result,
            error: payload.error?.message,
          },
        };

        return response;
      } catch (error) {
        const response: BrowserCommandResponse = {
          type: 'execute_js_response',
          data: {
            requestId: message.data.requestId,
            error: error instanceof Error ? error.message : String(error),
          },
        };

        return response;
      }
    }

    case 'get_page_info': {
      try {
        const response: BrowserCommandResponse = {
          type: 'page_info_response',
          data: {
            requestId: message.data.requestId,
            title: document.title,
            url: window.location.href,
            html: message.data.includeHtml ? document.documentElement.outerHTML : undefined,
          },
        };

        return response;
      } catch (error) {
        const response: BrowserCommandResponse = {
          type: 'page_info_response',
          data: {
            requestId: message.data.requestId,
            title: '',
            url: '',
            error: error instanceof Error ? error.message : String(error),
          },
        };

        return response;
      }
    }

    case 'query_dom': {
      try {
        const elements = document.querySelectorAll(message.data.selector);
        const defaultProperties = ['textContent', 'className', 'id', 'tagName'];
        const propertiesToExtract = message.data.properties || defaultProperties;

        const results = Array.from(elements).map((element) => {
          const properties: Record<string, unknown> = {};

          for (const prop of propertiesToExtract) {
            try {
              properties[prop] = (element as any)[prop];
            } catch {
              properties[prop] = undefined;
            }
          }

          return {
            selector: message.data.selector,
            properties,
          };
        });

        const response: BrowserCommandResponse = {
          type: 'query_dom_response',
          data: {
            requestId: message.data.requestId,
            elements: results,
          },
        };

        return response;
      } catch (error) {
        const response: BrowserCommandResponse = {
          type: 'query_dom_response',
          data: {
            requestId: message.data.requestId,
            elements: [],
            error: error instanceof Error ? error.message : String(error),
          },
        };

        return response;
      }
    }

    case 'get_dom_snapshot': {
      try {
        const snapshot = buildDomSnapshot(document.body);
        const response: BrowserCommandResponse = {
          type: 'dom_snapshot_response',
          data: {
            requestId: message.data.requestId,
            snapshot: snapshot ?? undefined,
          },
        };
        return response;
      } catch (error) {
        const response: BrowserCommandResponse = {
          type: 'dom_snapshot_response',
          data: {
            requestId: message.data.requestId,
            error: error instanceof Error ? error.message : String(error),
          },
        };
        return response;
      }
    }

    default:
      return null;
  }
}

function buildDomSnapshot(element: Element | null, maxDepth = 10): DomSnapshotNode | null {
  if (!element || maxDepth <= 0) {
    return null;
  }

  const role = getRole(element);
  const name = getAccessibleName(element);
  const value = getValue(element);
  const description = getDescription(element);
  const properties = getProperties(element);

  const children: DomSnapshotNode[] = [];
  for (const child of Array.from(element.children)) {
    const childSnapshot = buildDomSnapshot(child, maxDepth - 1);
    if (childSnapshot) {
      children.push(childSnapshot);
    }
  }

  const node: DomSnapshotNode = {
    role,
    ...(name && { name }),
    ...(value && { value }),
    ...(description && { description }),
    ...(Object.keys(properties).length > 0 && { properties }),
    ...(children.length > 0 && { children }),
  };

  return node;
}

const ROLE_MAP: Record<string, string> = {
  a: 'link',
  button: 'button',
  textarea: 'textbox',
  select: 'combobox',
  img: 'img',
  h1: 'heading',
  h2: 'heading',
  h3: 'heading',
  h4: 'heading',
  h5: 'heading',
  h6: 'heading',
  nav: 'navigation',
  main: 'main',
  article: 'article',
  section: 'region',
  aside: 'complementary',
  header: 'banner',
  footer: 'contentinfo',
  form: 'form',
  ul: 'list',
  ol: 'list',
  li: 'listitem',
  table: 'table',
  thead: 'rowgroup',
  tbody: 'rowgroup',
  tr: 'row',
  th: 'columnheader',
  td: 'cell',
};

function getRole(element: Element): string {
  const ariaRole = element.getAttribute('role');
  if (ariaRole) return ariaRole;

  const tagName = element.tagName.toLowerCase();

  if (tagName === 'input') {
    return getInputRole(element as HTMLInputElement);
  }

  return ROLE_MAP[tagName] || 'generic';
}

function getInputRole(input: HTMLInputElement): string {
  const type = input.type?.toLowerCase() || 'text';
  const roleMap: Record<string, string> = {
    button: 'button',
    checkbox: 'checkbox',
    radio: 'radio',
    range: 'slider',
    submit: 'button',
    reset: 'button',
    file: 'button',
    image: 'button',
  };
  return roleMap[type] || 'textbox';
}

function getAccessibleName(element: Element): string | undefined {
  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel;

  const ariaLabelledBy = element.getAttribute('aria-labelledby');
  if (ariaLabelledBy) {
    const labelElement = document.getElementById(ariaLabelledBy);
    if (labelElement) return labelElement.textContent?.trim() || undefined;
  }

  const label = element.closest('label');
  if (label) {
    const labelText = label.textContent?.trim();
    if (labelText) return labelText;
  }

  if (element.tagName === 'IMG') {
    const alt = (element as HTMLImageElement).alt;
    if (alt) return alt;
  }

  if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
    const placeholder = (element as HTMLInputElement).placeholder;
    if (placeholder) return placeholder;
  }

  const textContent = element.textContent?.trim();
  if (textContent && textContent.length < 200) {
    return textContent;
  }

  return undefined;
}

function getValue(element: Element): string | undefined {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    return element.value || undefined;
  }
  if (element instanceof HTMLSelectElement) {
    return element.value || undefined;
  }
  return undefined;
}

function getDescription(element: Element): string | undefined {
  const ariaDescribedBy = element.getAttribute('aria-describedby');
  if (ariaDescribedBy) {
    const descElement = document.getElementById(ariaDescribedBy);
    if (descElement) return descElement.textContent?.trim() || undefined;
  }
  return undefined;
}

function getProperties(element: Element): Record<string, unknown> {
  const props: Record<string, unknown> = {};

  if (element instanceof HTMLInputElement) {
    if (element.checked !== undefined) props.checked = element.checked;
    if (element.disabled) props.disabled = true;
    if (element.required) props.required = true;
    if (element.readOnly) props.readonly = true;
  }

  if (element instanceof HTMLButtonElement) {
    if (element.disabled) props.disabled = true;
  }

  const ariaExpanded = element.getAttribute('aria-expanded');
  if (ariaExpanded !== null) props.expanded = ariaExpanded === 'true';

  const ariaSelected = element.getAttribute('aria-selected');
  if (ariaSelected !== null) props.selected = ariaSelected === 'true';

  const ariaHidden = element.getAttribute('aria-hidden');
  if (ariaHidden === 'true') props.hidden = true;

  return props;
}
