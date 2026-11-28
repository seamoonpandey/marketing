// Tagged blocks of untrusted data in a prompt. Text inside a block must not be able to close it: what followed would
// reach the model outside any data block.

/** JSON for a data block, with every "</" written "<\/" (still valid JSON), so no string inside can close the block. */
export const dataJson = (x: unknown): string => JSON.stringify(x).replace(/<\//g, '<\\/');

/** A block of untrusted text; its own closing tag is broken inside it, so the text cannot end the block early. */
export const dataBlock = (tag: string, text: string, attrs = ''): string =>
  `<${tag}${attrs}>\n${text.replace(new RegExp(`</(${tag})`, 'gi'), '<\\/$1')}\n</${tag}>`;
