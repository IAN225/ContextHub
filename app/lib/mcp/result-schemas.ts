import { summaryEngines } from '../summary/engines.ts';
import {
  array,
  boolean,
  choice,
  id,
  integer,
  nullable,
  obj,
  revision,
  sourceRange,
  str,
} from './schema.ts';
export const contextFields = {
  workspace_id: id,
  workspace: str(),
  read_at: str(),
};
export const summary = obj(
  {
    id,
    title: str(),
    text: str(),
    covered_turn_ids: array(id),
    created_at: str(),
    generation: obj(
      {
        model: str(),
        protocol: str(),
        strategy: str(),
        usage: obj({ input: integer(), output: integer() }, []),
      },
      ['model', 'protocol'],
    ),
  },
  ['id', 'title', 'text', 'covered_turn_ids', 'created_at'],
);
const message = obj(
  {
    role: str(),
    content: str(),
    name: str(),
    call_id: str(),
    attachment_ids: array(id),
  },
  ['role', 'content'],
);
const attachment = obj({ id, name: str(), type: str(), text: str() }, [
  'id',
  'name',
  'type',
]);
export const turn = obj({
  number: integer(1),
  id,
  title: str(),
  source: str(),
  time: nullable(str()),
  messages: array(message),
  attachments: array(attachment),
});
export const transcriptFields = {
  workspace_id: id,
  workspace: str(),
  total_turns: integer(),
  available_turns: integer(),
  source: nullable(sourceRange),
  base_summary_revision: revision,
};
export const noteListResult = obj({
  ...contextFields,
  total: integer(),
  items: array(
    obj({ id, title: str(), star: boolean, preview: str('', 50) }, [
      'id',
      'title',
      'star',
    ]),
    100,
  ),
  next_offset: nullable(integer()),
});
export const noteReadResult = obj({
  ...contextFields,
  id,
  title: str(),
  body: str(),
  star: boolean,
  updated_at: str(),
  revision,
});
export const noteCreateResult = obj({
  ...contextFields,
  id,
  title: str(),
  star: boolean,
  updated_at: str(),
  revision,
  saved: { type: 'boolean', const: true },
});
export const noteReplaceResult = obj({
  ...contextFields,
  id,
  updated_at: str(),
  revision,
  saved: { type: 'boolean', const: true },
});
export const memoryResult = obj({
  ...contextFields,
  content: str(),
  engine: choice(summaryEngines),
  summary_id: nullable(id),
  covered_turn_ids: array(id),
  recent_turn_ids: array(id),
  omitted_turn_ids: array(id),
  status: choice(['ready', 'no_summary']),
  strategy_version: nullable(str()),
});
export const searchResult = obj({
  ...contextFields,
  engine: choice(summaryEngines),
  total: integer(),
  items: array(
    obj(
      {
        id,
        title: str('', 200),
        kind: choice(['turn', 'summary', 'note']),
        excerpt: str('', 280),
        number: integer(1),
      },
      ['id', 'title', 'kind', 'excerpt'],
    ),
    100,
  ),
  next_offset: nullable(integer()),
});
export const summaryReadResult = obj({
  ...contextFields,
  engine: choice(summaryEngines),
  revision,
  active_id: nullable(id),
  summary: nullable(summary),
  total_turns: integer(),
  recent_from_turn: nullable(integer(1)),
});
export const conversationResult = {
  type: 'object' as const,
  anyOf: [
    obj({
      ...transcriptFields,
      turns: array(turn, 100),
      next_offset: nullable(integer()),
    }),
    obj({
      ...transcriptFields,
      download: obj({
        url: str(),
        expires_at: str(),
        filename: str(),
        format: { type: 'string', const: 'json' },
      }),
    }),
  ],
};
export const summarySubmitResult = obj({
  ...contextFields,
  saved: { type: 'boolean', const: true },
  engine: { type: 'string', const: 'client' },
  summary_id: id,
  summary_revision: revision,
  source: sourceRange,
  covered_turn_ids: array(id),
  covered_turns: integer(),
  memory_engine: choice(summaryEngines),
});
export const importResult = obj({
  ...contextFields,
  upload_id: id,
  title: str(),
  turns: integer(),
  status: { type: 'string', const: 'pending_confirmation' },
  message: str(),
});
