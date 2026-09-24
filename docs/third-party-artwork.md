# Conversation ornaments

## Corners

`app/public/ornaments/gilt-corner.svg` was supplied in the user-provided `contexthub-gilt-v3.patch`, whose artwork comment identifies it as original ContextHub artwork. It replaces the earlier geometric corner with a small flourish and twin edge rules that fade at 65% of each edge. Only the bottom-left and top-right corners are shown.

Decorations are noninteractive and hidden from assistive technology. There is no separator below the user message. Tool calls and results appear in chronological order inside their assistant message group; source messages and attachment indexes are unchanged.


Turn dividers use an original miniature clock dial to the left of an italic serif round number, framed by <· and ·> marks. The dial is 17px and does not contain the number.

The patch's gilt color tokens live in app/theme.css; conversation, button and tab rules are integrated into their existing component stylesheets instead of a late override file. The selected-tab diamond stays inside the scroll rail to avoid clipping.
