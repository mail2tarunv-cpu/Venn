// Venn test seed. Builds an OLDER version of the Penny 2.0 tokens in the Penny test file, with the kinds
// of mistakes Venn should find, plus Light and Dark frames of UI bound to those variables.
// Only runs in the separate Penny test file, and only once.
const TEST_FILE_KEY = 'nfPIHqVPJv4OJ5yOavc1ha';
const COLLECTION = 'Penny 2.0';
const PAGE = 'Penny 2.0 · Sync test';

const rgb = (hex) => ({ r: parseInt(hex.slice(1, 3), 16) / 255, g: parseInt(hex.slice(3, 5), 16) / 255, b: parseInt(hex.slice(5, 7), 16) / 255 });

async function main() {
  const isTestFile = figma.fileKey ? figma.fileKey === TEST_FILE_KEY : /Sync Lab/.test(figma.root.name);
  if (!isTestFile) return figma.closePlugin('Venn test seed only runs in the Penny test file. Nothing was changed.');
  const existing = (await figma.variables.getLocalVariableCollectionsAsync()).find((c) => c.name === COLLECTION);
  if (existing || figma.root.children.some((p) => p.name === PAGE)) return figma.closePlugin('Penny 2.0 test data already exists. Nothing was changed.');

  const collection = figma.variables.createVariableCollection(COLLECTION);
  const light = collection.modes[0].modeId;
  collection.renameMode(light, 'Light');
  const dark = collection.addMode('Dark');
  const vars = {};
  const color = (name, l, d) => { const v = figma.variables.createVariable(name, collection, 'COLOR'); v.setValueForMode(light, l); v.setValueForMode(dark, d === undefined ? l : d); vars[name] = v; return v; };
  const num = (name, l) => { const v = figma.variables.createVariable(name, collection, 'FLOAT'); v.setValueForMode(light, l); v.setValueForMode(dark, l); vars[name] = v; return v; };
  const alias = (name) => figma.variables.createVariableAlias(vars[name]);

  // Primitives, as they were before the last few pushes.
  color('color/green/600', rgb('#008254'));
  color('color/neutral/0', rgb('#FFFFFF'));
  color('color/neutral/900', rgb('#202020'));          // stale: code is #18181B
  color('color/neutral/950', rgb('#0B0B0C'));
  // missing on purpose: color/green/700, color/neutral/50, color/blue/400, color/blue/600

  // Semantic tokens, with typical mistakes.
  color('action/primary', rgb('#008254'));             // hard-coded green; code aliases cobalt
  color('text/primary', alias('color/neutral/900'));   // right in Light, wrong in Dark
  color('text/on-brand', alias('color/neutral/0'));    // correct
  color('background/page', rgb('#FFFFFF'));            // hard-coded, and white in Dark too
  // missing on purpose: background/surface

  num('radius/button', 2);                             // stale: 12
  num('radius/card', 12);                              // stale: 16
  num('spacing/component', 12);                        // stale: 16
  num('font/size/body', 14);                           // stale: 16
  num('font/size/heading', 24);                        // stale: 28
  num('font/line-height/body', 20);                    // stale: 24
  num('shadow/opacity', 0.12);                         // only in Figma: should be reported, not deleted
  // missing on purpose: radius/input, spacing/section

  await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
  await figma.loadFontAsync({ family: 'Inter', style: 'Semi Bold' });
  const page = figma.createPage();
  page.name = PAGE;
  await figma.setCurrentPageAsync(page);

  const fill = (node, name) => { node.fills = [figma.variables.setBoundVariableForPaint({ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }, 'color', vars[name])]; };
  const corners = (node, name) => { for (const k of ['topLeftRadius', 'topRightRadius', 'bottomLeftRadius', 'bottomRightRadius']) node.setBoundVariable(k, vars[name]); };
  const pad = (node, name) => { for (const k of ['paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom']) node.setBoundVariable(k, vars[name]); };
  const text = (chars, size, colorVar, weight) => {
    const t = figma.createText();
    t.fontName = { family: 'Inter', style: weight || 'Regular' };
    t.characters = chars;
    t.setBoundVariable('fontSize', vars[size]);
    if (size === 'font/size/body') { try { t.setBoundVariable('lineHeight', vars['font/line-height/body']); } catch (e) { /* older API */ } }
    fill(t, colorVar);
    return t;
  };
  const stack = (name, dir) => { const f = figma.createFrame(); f.name = name; f.layoutMode = dir || 'VERTICAL'; f.primaryAxisSizingMode = 'AUTO'; f.counterAxisSizingMode = 'AUTO'; f.fills = []; return f; };

  function screen(modeName, modeId, x) {
    const frame = stack(`Penny 2.0 · ${modeName}`);
    frame.x = x; frame.y = 0;
    frame.counterAxisSizingMode = 'FIXED'; frame.resize(420, 100); frame.primaryAxisSizingMode = 'AUTO';
    fill(frame, 'background/page');
    pad(frame, 'spacing/component');
    frame.itemSpacing = 16;
    frame.cornerRadius = 20;
    frame.setExplicitVariableModeForCollection(collection, modeId);

    frame.appendChild(text('Penny 2.0', 'font/size/heading', 'text/primary', 'Semi Bold'));
    frame.appendChild(text('Every colour, radius, size and gap on this frame is bound to a variable.', 'font/size/body', 'text/primary'));
    frame.children[1].layoutSizingHorizontal = 'FILL';

    const card = stack('Card');
    fill(card, 'background/page');
    corners(card, 'radius/card');
    pad(card, 'spacing/component');
    card.itemSpacing = 12;
    card.strokes = [{ type: 'SOLID', color: { r: 0.5, g: 0.5, b: 0.5 }, opacity: 0.25 }];
    card.appendChild(text('Create a learning assistant', 'font/size/body', 'text/primary', 'Semi Bold'));
    const input = stack('Input', 'HORIZONTAL');
    input.cornerRadius = 4;                              // radius/input does not exist yet
    input.paddingLeft = input.paddingRight = 12; input.paddingTop = input.paddingBottom = 10;
    input.strokes = [{ type: 'SOLID', color: { r: 0.5, g: 0.5, b: 0.5 }, opacity: 0.4 }];
    input.appendChild(text('Help students reason through fractions', 'font/size/body', 'text/primary'));
    card.appendChild(input);
    const button = stack('Button / Primary', 'HORIZONTAL');
    fill(button, 'action/primary');
    corners(button, 'radius/button');
    button.setBoundVariable('paddingLeft', vars['spacing/component']);
    button.setBoundVariable('paddingRight', vars['spacing/component']);
    button.paddingTop = button.paddingBottom = 10;
    button.appendChild(text('Continue', 'font/size/body', 'text/on-brand', 'Semi Bold'));
    card.appendChild(button);
    frame.appendChild(card);
    card.layoutSizingHorizontal = 'FILL';
    return frame;
  }

  const a = screen('Light', light, 0);
  const b = screen('Dark', dark, 480);
  figma.viewport.scrollAndZoomIntoView([a, b]);
  figma.closePlugin('Penny 2.0 older version created: 16 variables, Light and Dark frames. Now run Venn.');
}

main().catch((err) => figma.closePlugin('Seed failed: ' + (err && err.message ? err.message : err)));
