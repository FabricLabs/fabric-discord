'use strict';

// Discord component types that carry text a reader sees. Buttons, menus, and
// separators carry none worth reading back.
const SECTION = 9;
const TEXT_DISPLAY = 10;
const CONTAINER = 17;
const MAX_DEPTH = 8;

/** discord.js objects (Embed, Component) expose their API shape through `toJSON`. */
function plain (value) {
  return value && typeof value.toJSON === 'function' ? value.toJSON() : value;
}

function pushText (out, text) {
  for (const line of String(text == null ? '' : text).split('\n')) {
    const trimmed = line.trim();
    if (trimmed) out.push(trimmed);
  }
}

function componentLines (components, out, depth) {
  if (!Array.isArray(components) || depth > MAX_DEPTH) return;
  for (const item of components) {
    const component = plain(item);
    if (!component || typeof component !== 'object') continue;
    if (component.type === TEXT_DISPLAY) pushText(out, component.content);
    else if (component.type === CONTAINER || component.type === SECTION) componentLines(component.components, out, depth + 1);
  }
}

function embedLines (embeds, out) {
  if (!Array.isArray(embeds)) return;
  for (const item of embeds) {
    const embed = plain(item);
    if (!embed || typeof embed !== 'object') continue;
    if (embed.author && embed.author.name) pushText(out, embed.author.name);
    pushText(out, embed.title);
    pushText(out, embed.description);
    for (const field of Array.isArray(embed.fields) ? embed.fields : []) {
      if (!field) continue;
      pushText(out, field.name);
      pushText(out, field.value);
    }
    if (embed.footer && embed.footer.text) pushText(out, embed.footer.text);
  }
}

/**
 * The text a reader sees in a Discord message, one trimmed line per entry:
 * its content, then its embeds (author, title, description, fields, footer),
 * then the text displays of its components (Components V2 containers and
 * sections, as music bots such as Tempo post). Takes a discord.js `Message`
 * or the API JSON for one. Markdown is kept as written.
 * @param {Object} message
 * @returns {string[]}
 */
function messageText (message) {
  const out = [];
  if (!message || typeof message !== 'object') return out;
  pushText(out, message.content);
  embedLines(message.embeds, out);
  componentLines(message.components, out, 0);
  return out;
}

module.exports = messageText;
module.exports.messageText = messageText;
