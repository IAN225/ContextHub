import postcss from 'postcss';

// Physical sides only: logical sides depend on writing-mode/direction.
const groups = {
  margin: ['margin-top', 'margin-right', 'margin-bottom', 'margin-left'],
  padding: ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'],
  gap: ['row-gap', 'column-gap'],
  'margin-inline': ['margin-inline-start', 'margin-inline-end'],
  'margin-block': ['margin-block-start', 'margin-block-end'],
  'padding-inline': ['padding-inline-start', 'padding-inline-end'],
  'padding-block': ['padding-block-start', 'padding-block-end'],
};
const properties = (decl) =>
  groups[decl.prop.toLowerCase()] ?? [
    decl.prop.startsWith('--') ? decl.prop : decl.prop.toLowerCase(),
  ];
const overrides = (later, earlier) =>
  Boolean(later.important) || !earlier.important;

export function checkStyles(file, text, owners, errors, warnings) {
  const seen = new Set(),
    mediaRules = [];
  const root = postcss.parse(text, { from: file });
  root.walkRules((rule) => {
    const context = [];
    for (
      let parent = rule.parent;
      parent.type !== 'root';
      parent = parent.parent
    )
      context.unshift(`${parent.name} ${parent.params}`);
    const at = `${file}:${rule.source.start.line}`;
    const declarations = (rule.nodes ?? []).filter(
      (node) => node.type === 'decl',
    );
    for (let i = 0; i < declarations.length; i++) {
      const earlier = declarations[i];
      const later = declarations
        .slice(i + 1)
        .filter((decl) => overrides(decl, earlier));
      // Differing values for the same property can be deliberate browser fallbacks.
      const identical = later.some(
        (decl) => decl.prop === earlier.prop && decl.value === earlier.value,
      );
      const semantic = later.filter((decl) => decl.prop !== earlier.prop);
      const shadowed =
        groups[earlier.prop] ||
        semantic.some((decl) => groups[decl.prop]?.includes(earlier.prop));
      if (
        identical ||
        (shadowed &&
          properties(earlier).every((prop) =>
            semantic.some((decl) => properties(decl).includes(prop)),
          ))
      )
        errors.push(
          `${at}: shadowed CSS declaration ${earlier.prop} in ${rule.selector}`,
        );
    }
    for (const selector of rule.selectors) {
      const key = context.join('/') + '|' + selector;
      if (seen.has(key))
        errors.push(
          `${at}: repeated selector in the same context: ${selector}`,
        );
      seen.add(key);
      if (/^(features|components)\//.test(file)) {
        const owner = owners.get(key);
        if (owner && owner !== file)
          errors.push(`${at}: selector also owned by ${owner}: ${selector}`);
        owners.set(key, file);
      }
      // Advisory: equal-specificity rules in a wider later breakpoint may erase
      // narrower adjustments. Complex conditions and browser fallbacks need review.
      const max =
        context.length === 1 &&
        /^media \(max-width:\s*(\d+(?:\.\d+)?)px\)$/.exec(context[0]);
      if (max) {
        const width = Number(max[1]);
        for (const previous of mediaRules) {
          if (previous.selector !== selector || previous.width >= width)
            continue;
          const overwritten = previous.declarations.filter((earlier) =>
            declarations.some(
              (later) =>
                overrides(later, earlier) &&
                properties(earlier).some((prop) =>
                  properties(later).includes(prop),
                ),
            ),
          );
          if (overwritten.length)
            warnings.push(
              `${at}: wider max-width ${width}px follows ${previous.width}px for ${selector} (${[...new Set(overwritten.map((decl) => decl.prop))].join(', ')})`,
            );
        }
        mediaRules.push({ selector, width, declarations });
      }
    }
  });
}
