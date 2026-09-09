import type { Message } from '../../domain.ts';
import { ImportError, type ParserPlugin } from '../contracts.ts';

const roleMarker =
  /^(?:#{1,6}\s*)?(?:\*\*)?(user|human|you|assistant|chatgpt|claude|用户|人类|我|你|助手|模型)(?:\s+said|\s*说)?(?:\*\*)?\s*[:：]\s?(.*)$/i;
const roleHeading =
  /^(?:#{1,6}\s+|\*\*)(user|human|you|assistant|chatgpt|claude|用户|人类|我|你|助手|模型)(?:\*\*)?\s*$/i;
const webHeading = /^(You said|ChatGPT said|你说|您说|ChatGPT 说)[：:]?\s*$/i;
const isUser = (label: string) =>
  /^(user|human|you|用户|人类|我|你|您)/i.test(label);

export const manualParser: ParserPlugin<string> = {
  id: 'manual-text',
  version: 1,
  label: '手动复制',
  parse(input) {
    const text = input.replace(/\r\n?/g, '\n').trim();
    if (!text) throw new ImportError('EMPTY_TEXT', '请先粘贴对话内容。');
    const messages: Message[] = [];
    let current: Message | undefined;
    let fence = '';
    const preamble: string[] = [];
    for (const line of text.split('\n')) {
      const code = /^\s*(`{3,}|~{3,})/.exec(line);
      if (code) {
        if (!fence) fence = code[1];
        else if (code[1][0] === fence[0] && code[1].length >= fence.length)
          fence = '';
      }
      const marker =
        !fence &&
        !code &&
        (roleMarker.exec(line) ||
          roleHeading.exec(line) ||
          webHeading.exec(line));
      if (marker) {
        current = {
          role: isUser(marker[1]) ? 'user' : 'assistant',
          content: marker[2] ?? '',
        };
        messages.push(current);
      } else if (current)
        current.content += `${current.content ? '\n' : ''}${line}`;
      else preamble.push(line);
    }
    if (!messages.length)
      return {
        messages: [{ role: 'user', content: text }],
        issues: [
          {
            code: 'UNMARKED_TEXT',
            message:
              '未识别到角色标记，暂按一条用户原文导入。若包含多轮对话，请使用“用户：”和“助手：”分隔。',
          },
        ],
      };
    if (preamble.join('').trim())
      throw new ImportError(
        'AMBIGUOUS_PREAMBLE',
        '首个角色标记前还有正文，请为它补上“用户：”或“助手：”，避免遗漏。',
      );
    if (messages[0].role !== 'user')
      throw new ImportError(
        'LEADING_ASSISTANT',
        '对话从助手回复开始，请补上对应的用户消息。',
      );
    return {
      messages: messages.map((m) => ({ ...m, content: m.content.trim() })),
      issues: [],
    };
  },
};
