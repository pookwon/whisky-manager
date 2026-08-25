/**
 * Chrome's own extensions page.
 *
 * Both processes need this string and neither may import the other's, so it
 * lives here: the main process copies it to the clipboard, and the setup guide
 * shows the operator what they are about to paste.
 *
 * It is deliberately not passed to Chrome on the command line. Chrome drops
 * `chrome://` arguments and opens a new tab instead — verified against Chrome
 * 151 on a fresh start, on a forwarded start, and with `--app=` — so a launch
 * that appeared to ask for this page would silently do something else.
 */
export const CHROME_EXTENSIONS_URL = 'chrome://extensions'
