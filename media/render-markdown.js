'use strict';

const MarkdownIt = require('markdown-it');
const highlight = require('highlight.js/lib/common');

const markdown = new MarkdownIt({
  html: false,
  linkify: false,
  highlight(code, language) {
    return highlight.getLanguage(language) ? highlight.highlight(code, { language, ignoreIllegals: true }).value : '';
  },
});
// Link labels and image alt text are useful in a conversation. Remote loads and navigations are disabled.
markdown.renderer.rules.link_open = () => '<span class="link-label">';
markdown.renderer.rules.link_close = () => '</span>';
markdown.renderer.rules.image = (tokens, index) => markdown.utils.escapeHtml(tokens[index].content);

module.exports = text => markdown.render(text);
