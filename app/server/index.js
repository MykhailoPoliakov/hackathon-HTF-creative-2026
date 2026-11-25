const fs = require('fs');
const http = require('http');
const path = require('path');

const appRoot = path.resolve(__dirname, '..');
const envPath = path.join(appRoot, '.env');
const catalogPath = path.join(appRoot, 'public', 'products.json');
const buildPath = path.join(appRoot, 'build');

function loadEnvironmentFile() {
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);

  for (const line of lines) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

loadEnvironmentFile();

const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
const productsBySku = new Map(catalog.map((product) => [product.sku, product]));

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(body));
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    let tooLarge = false;

    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > 100_000) {
        tooLarge = true;
        body = '';
      }
    });

    request.on('error', reject);
    request.on('end', () => {
      if (tooLarge) {
        reject(new HttpError(413, 'The request is too long.'));
        return;
      }

      try {
        resolve(JSON.parse(body || '{}'));
      } catch {
        reject(new HttpError(400, 'The request body is not valid JSON.'));
      }
    });
  });
}

function budgetFrom(message, requestedBudget) {
  const match = message.match(
    /(?:€\s*([\d.,]+)|([\d.,]+)\s*(?:€|eur(?:o|os)?|euro(?:s)?|евро))/i,
  );
  const fromMessage = match ? Number((match[1] || match[2]).replace(',', '.')) : null;
  const budget = fromMessage || Number(requestedBudget) || 30;

  if (!Number.isFinite(budget) || budget <= 0 || budget > 10_000) {
    throw new HttpError(400, 'Choose a budget between €0.01 and €10,000.');
  }

  return Math.round(budget * 100) / 100;
}

function createDemoPlan(message, budget) {
  const text = message.toLocaleLowerCase();
  let title = 'Smart weekly selection';
  let summary = 'An affordable mix from the catalogue, tailored to your budget.';
  let candidates = [
    { sku: 'DH-10041', quantity: 1, reason: 'A versatile staple for quick meals.' },
    { sku: 'DH-11010', quantity: 1, reason: 'Pairs well with pasta and weeknight dishes.' },
    { sku: 'DH-40001', quantity: 1, reason: 'A useful staple for breakfast and cooking.' },
    { sku: 'DH-70001', quantity: 1, reason: 'A snack to share.' },
    { sku: 'DH-90001', quantity: 1, reason: 'A drink to add to your shop.' },
  ];

  if (/bologn|болоньез|болонез/.test(text)) {
    title = 'Pasta Bolognese';
    summary = 'Ingredients for a classic pasta night. This list stays separate from your other basket items.';
    candidates = [
      { sku: 'DH-10041', quantity: 1, reason: 'Pasta base.' },
      { sku: 'DH-11011', quantity: 1, reason: 'Bolognese sauce.' },
      { sku: 'DH-20011', quantity: 1, reason: 'Mixed mince from the catalogue.' },
      { sku: 'DH-40011', quantity: 1, reason: 'Grated cheese to finish.' },
    ];
  } else if (/(soep|soup)/.test(text)) {
    title = 'Soup and sides';
    summary = 'A soup selection with bread and staples; feel free to adjust the quantities.';
    candidates = [
      { sku: 'DH-80002', quantity: 1, reason: 'Fresh pumpkin soup.' },
      { sku: 'DH-50002', quantity: 1, reason: 'Sliced bread on the side.' },
      { sku: 'DH-30001', quantity: 1, reason: 'Vegetables for an extra meal.' },
      { sku: 'DH-40001', quantity: 1, reason: 'A dairy staple from the catalogue.' },
    ];
  } else if (/(verjaardag|birthday|feest|party|день\s*рожд|(?:^|\s)др(?:$|\s)|празд)/.test(text)) {
    title = 'Birthday snack table';
    summary = 'Snacks, something sweet and drinks for a small birthday. Allergens are summarised in your basket.';
    candidates = [
      { sku: 'DH-70001', quantity: 1, reason: 'A savoury snack.' },
      { sku: 'DH-70002', quantity: 1, reason: 'Mixed nuts; contains nuts.' },
      { sku: 'DH-70010', quantity: 1, reason: 'A sweet treat.' },
      { sku: 'DH-70011', quantity: 1, reason: 'Dark chocolate.' },
      { sku: 'DH-90001', quantity: 2, reason: 'Orange juice to share.' },
      { sku: 'DH-90010', quantity: 1, reason: 'Sparkling water.' },
      { sku: 'DH-70020', quantity: 1, reason: 'Vanilla ice cream for dessert.' },
    ];
  }

  const items = [];
  let total = 0;

  for (const candidate of candidates) {
    const product = productsBySku.get(candidate.sku);
    if (!product || !Number.isFinite(product.prijs?.bedrag)) continue;

    const quantity = Math.min(candidate.quantity, 20);
    const lineTotal = product.prijs.bedrag * quantity;
    if (total + lineTotal > budget + 0.001) continue;

    items.push({ ...candidate, quantity });
    total += lineTotal;
  }

  if (items.length === 0) {
    throw new HttpError(422, 'Your budget is lower than the price of every product in this selection.');
  }

  return {
    title,
    summary,
    items,
    total: Math.round(total * 100) / 100,
  };
}

function validateCartSnapshot(rawCart) {
  if (rawCart == null) return [];
  if (!Array.isArray(rawCart) || rawCart.length > 30) {
    throw new HttpError(400, 'The basket snapshot is invalid.');
  }

  return rawCart.map((group) => {
    if (
      !group ||
      typeof group.id !== 'string' ||
      typeof group.title !== 'string' ||
      !Array.isArray(group.items) ||
      group.items.length > 100
    ) {
      throw new HttpError(400, 'A basket group has an invalid format.');
    }

    const items = group.items.map((item) => {
      if (
        !productsBySku.has(item.sku) ||
        !Number.isInteger(item.quantity) ||
        item.quantity < 1 ||
        item.quantity > 20
      ) {
        throw new HttpError(400, 'A basket item has an invalid SKU or quantity.');
      }
      return { sku: item.sku, quantity: item.quantity };
    });

    return {
      id: group.id.slice(0, 100),
      title: group.title.slice(0, 80),
      type: group.type === 'plan' ? 'plan' : 'manual',
      items,
    };
  });
}

function validateConversationHistory(rawHistory) {
  if (rawHistory == null) return [];
  if (!Array.isArray(rawHistory) || rawHistory.length > 12) {
    throw new HttpError(400, 'The conversation history is invalid.');
  }

  return rawHistory.map((entry) => {
    if (
      !entry ||
      !['user', 'assistant'].includes(entry.role) ||
      typeof entry.text !== 'string' ||
      entry.text.length > 1000
    ) {
      throw new HttpError(400, 'A conversation message has an invalid format.');
    }
    return { role: entry.role, content: entry.text };
  });
}

const ALLERGEN_IDS = new Set([
  'gluten', 'crustaceans', 'eggs', 'fish', 'peanuts', 'soybeans', 'milk',
  'tree_nuts', 'celery', 'mustard', 'sesame', 'sulphites', 'lupin', 'molluscs',
]);

function validateAllergies(rawAllergies) {
  if (rawAllergies == null) return [];
  if (!Array.isArray(rawAllergies) || rawAllergies.length > ALLERGEN_IDS.size) {
    throw new HttpError(400, 'The allergy selection is invalid.');
  }
  if (rawAllergies.some((id) => !ALLERGEN_IDS.has(id))) {
    throw new HttpError(400, 'The allergy selection contains an unknown allergen.');
  }
  return [...new Set(rawAllergies)];
}

function productConflicts(sku, allergies) {
  const allergens = productsBySku.get(sku)?.allergenen;
  const listed = new Set([...(allergens?.bevat || []), ...(allergens?.kan_bevatten || [])]);
  return allergies.filter((id) => listed.has(id));
}

// Last line of defence: never add a product that conflicts with the shopper's allergies.
function enforceAllergies(result, allergies) {
  if (allergies.length === 0) return result;

  if (result.action === 'create_list' || result.action === 'add_items') {
    const items = result.items.filter((item) => productConflicts(item.sku, allergies).length === 0);
    if (items.length === result.items.length) return result;
    if (items.length === 0) {
      return {
        action: 'reply',
        message: 'I left those products out because they conflict with the allergies you selected. Ask me for an alternative.',
      };
    }
    const total = items.reduce(
      (sum, item) => sum + productsBySku.get(item.sku).prijs.bedrag * item.quantity,
      0,
    );
    return {
      ...result,
      items,
      ...(result.action === 'create_list' ? { total: Math.round(total * 100) / 100 } : {}),
      message: `${result.message} I left out products that conflict with your selected allergies.`.slice(0, 1200),
    };
  }

  if (result.action === 'replace_item' && productConflicts(result.add_sku, allergies).length > 0) {
    return {
      action: 'reply',
      message: 'That replacement conflicts with the allergies you selected, so I kept your basket unchanged.',
    };
  }

  return result;
}

function normalizeText(value) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function findMentionedProducts(message) {
  const searchText = normalizeText(message)
    .replace(/^(please\s+)?(remove|delete|take out|add|put|include|buy)\s+/, '')
    .replace(/\s+(from|out of|to|into|in my|from my|please).*$/, '')
    .replace(/^(the|a|an|some|one|item|product)\s+/, '');
  const ignoredWords = new Set([
    'please', 'the', 'a', 'an', 'some', 'one', 'item', 'product', 'my', 'basket',
    'cart', 'list', 'plan', 'pack', 'for', 'me', 'and', 'of',
  ]);
  const words = searchText.split(' ').filter((word) => word.length > 2 && !ignoredWords.has(word));
  if (words.length === 0) return [];

  const matches = catalog
    .map((product) => {
      const name = normalizeText(product.product_naam);
      const score = words.filter((word) => name.includes(word)).length;
      return { product, score };
    })
    .filter((match) => match.score > 0);
  const bestScore = Math.max(0, ...matches.map((match) => match.score));
  return matches.filter((match) => match.score === bestScore).map((match) => match.product);
}

function createDemoAction(message, budget, cart) {
  const text = normalizeText(message);
  if (/\b(clear|empty)\b.*\b(basket|cart)\b/.test(text)) {
    return { action: 'clear_basket', message: 'I cleared your basket.' };
  }

  if (/\b(remove|delete|clear)\b.*\b(list|plan|pack)\b/.test(text)) {
    const plans = cart.filter((group) => group.type === 'plan');
    const mentionedPlans = plans.filter((group) => {
      const titleWords = normalizeText(group.title).split(' ').filter((word) => word.length > 3);
      return titleWords.some((word) => text.includes(word));
    });
    const target = mentionedPlans.length === 1
      ? mentionedPlans[0]
      : plans.length === 1
        ? plans[0]
        : null;

    if (target) {
      return {
        action: 'remove_list',
        group_id: target.id,
        message: `Removed the "${target.title}" list.`,
      };
    }
    return { action: 'reply', message: 'Which shopping list would you like me to remove?' };
  }

  if (/\b(remove|delete|take out|exclude)\b/.test(text)) {
    const products = findMentionedProducts(message);
    if (products.length !== 1) {
      return { action: 'reply', message: 'Which product would you like me to remove?' };
    }

    const sku = products[0].sku;
    const groupsWithProduct = cart.filter((group) => group.items.some((item) => item.sku === sku));
    if (groupsWithProduct.length === 0) {
      return { action: 'reply', message: `I couldn't find ${products[0].product_naam} in your basket.` };
    }
    if (groupsWithProduct.length > 1) {
      return {
        action: 'reply',
        message: `${products[0].product_naam} is in more than one list. Which list should I remove it from?`,
      };
    }
    return {
      action: 'remove_item',
      group_id: groupsWithProduct[0].id,
      sku,
      message: `Removed ${products[0].product_naam} from your basket.`,
    };
  }

  if (/\b(add|put|include|buy)\b/.test(text) && !/\b(birthday|party|bologn|soup|recipe|dinner|shopping list|meal)\b/.test(text)) {
    const products = findMentionedProducts(message);
    if (products.length === 1) {
      return {
        action: 'add_items',
        items: [{ sku: products[0].sku, quantity: 1 }],
        message: `Added ${products[0].product_naam} to your basket.`,
      };
    }
    return {
      action: 'reply',
      message: products.length > 1
        ? 'Which product did you mean? I found more than one match.'
        : 'I could not match that product in the catalogue. Try its product name.',
    };
  }

  const plan = createDemoPlan(message, budget);
  return {
    action: 'create_list',
    ...plan,
    message: `Added "${plan.title}" as a separate shopping list.`,
  };
}

function parseAssistantJson(content) {
  if (typeof content !== 'string') {
    throw new HttpError(502, 'The AI provider did not return JSON text.');
  }

  const jsonText = content.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
  try {
    return JSON.parse(jsonText);
  } catch {
    throw new HttpError(502, 'The AI provider returned invalid JSON.');
  }
}

function validatePlan(rawPlan, budget) {
  if (
    !rawPlan ||
    typeof rawPlan.title !== 'string' ||
    typeof rawPlan.summary !== 'string' ||
    !Array.isArray(rawPlan.items) ||
    rawPlan.items.length === 0 ||
    rawPlan.items.length > 12
  ) {
    throw new HttpError(502, 'The AI provider returned a plan with an invalid structure.');
  }

  const mergedItems = new Map();
  for (const item of rawPlan.items) {
    const product = productsBySku.get(item.sku);
    if (!product) {
      throw new HttpError(502, `The AI provider referenced an unknown SKU: ${item.sku}.`);
    }

    if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 20) {
      throw new HttpError(502, `The AI provider returned an invalid quantity for ${item.sku}.`);
    }

    const existing = mergedItems.get(item.sku);
    mergedItems.set(item.sku, {
      sku: item.sku,
      quantity: (existing?.quantity || 0) + item.quantity,
      reason: typeof item.reason === 'string' ? item.reason.slice(0, 180) : '',
    });
  }

  const items = [...mergedItems.values()];
  if (items.some((item) => item.quantity > 20)) {
    throw new HttpError(502, 'The AI provider returned more than 20 units of a product.');
  }

  const total = items.reduce(
    (sum, item) => sum + productsBySku.get(item.sku).prijs.bedrag * item.quantity,
    0,
  );
  if (total > budget + 0.001) {
    throw new HttpError(
      422,
      `The proposed list costs €${total.toFixed(2)}, above your budget of €${budget.toFixed(2)}.`,
    );
  }

  return {
    title: rawPlan.title.slice(0, 80),
    summary: rawPlan.summary.slice(0, 240),
    items,
    total: Math.round(total * 100) / 100,
  };
}

function validateAssistantAction(rawAction, budget, cart) {
  if (!rawAction || typeof rawAction.action !== 'string') {
    throw new HttpError(502, 'The AI provider returned an invalid basket action.');
  }

  const message = typeof rawAction.message === 'string'
    ? rawAction.message.slice(0, 1200)
    : 'Done.';

  if (rawAction.action === 'create_list') {
    const plan = validatePlan(rawAction, budget);
    return { action: 'create_list', ...plan, message };
  }

  if (rawAction.action === 'add_items') {
    const validated = validatePlan(
      { title: 'Basket items', summary: '', items: rawAction.items },
      Number.MAX_SAFE_INTEGER,
    );
    return { action: 'add_items', items: validated.items, message };
  }

  if (rawAction.action === 'remove_item') {
    const group = cart.find((entry) => entry.id === rawAction.group_id);
    if (
      !group ||
      typeof rawAction.sku !== 'string' ||
      !productsBySku.has(rawAction.sku) ||
      !group.items.some((item) => item.sku === rawAction.sku)
    ) {
      throw new HttpError(422, 'The requested product is not in that basket list.');
    }
    return { action: 'remove_item', group_id: group.id, sku: rawAction.sku, message };
  }

  if (rawAction.action === 'replace_item') {
    const group = cart.find((entry) => entry.id === rawAction.group_id);
    const existing = group?.items.find((item) => item.sku === rawAction.remove_sku);
    const quantity = rawAction.quantity ?? existing?.quantity;
    if (
      !group ||
      !existing ||
      typeof rawAction.add_sku !== 'string' ||
      !productsBySku.has(rawAction.add_sku) ||
      rawAction.add_sku === rawAction.remove_sku ||
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > 20
    ) {
      throw new HttpError(422, 'The requested product substitution is not valid for that basket list.');
    }
    return {
      action: 'replace_item',
      group_id: group.id,
      remove_sku: existing.sku,
      add_sku: rawAction.add_sku,
      quantity,
      message,
    };
  }

  if (rawAction.action === 'remove_list') {
    const group = cart.find((entry) => entry.id === rawAction.group_id && entry.type === 'plan');
    if (!group) throw new HttpError(422, 'That shopping list is not in your basket.');
    return { action: 'remove_list', group_id: group.id, message };
  }

  if (rawAction.action === 'clear_basket') {
    return { action: 'clear_basket', message };
  }

  if (rawAction.action === 'reply') {
    return {
      action: 'reply',
      message: typeof rawAction.message === 'string' && rawAction.message.trim()
        ? rawAction.message.slice(0, 1200)
        : 'I need a little more detail to update your basket.',
    };
  }

  throw new HttpError(502, `The AI provider returned an unsupported action: ${rawAction.action}.`);
}

async function createActionWithProvider(message, budget, cart, history, allergies) {
  const providerUrl =
    process.env.AI_API_URL || 'https://api.x.ai/v1/chat/completions';
  const model = process.env.AI_MODEL || 'grok-4.7';
  const productContext = catalog.map((product) => ({
    sku: product.sku,
    name: product.product_naam,
    price_eur: product.prijs.bedrag,
    package: product.inhoud.weergave,
    category: product.categorie,
    ingredients: product.ingredienten,
    allergens: product.allergenen,
  }));
  const cartContext = cart.map((group) => ({
    id: group.id,
    title: group.title,
    type: group.type,
    items: group.items.map((item) => ({
      sku: item.sku,
      name: productsBySku.get(item.sku).product_naam,
      quantity: item.quantity,
    })),
  }));

  let response;
  try {
    response = await fetch(providerUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.AI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0.25,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              'You are a helpful Delhaize grocery shopping assistant, not just a basket tool. You can answer product questions, compare options, suggest meals, discuss ingredients and allergens, and understand follow-up questions using conversation_history. Use only facts and prices from the supplied catalogue; never invent ingredients, allergens, or product details. Return exactly one JSON action: create_list (title, summary, items), add_items (items), remove_item (group_id, sku), replace_item (group_id, remove_sku, add_sku, quantity), remove_list (group_id), clear_basket, or reply (message). Use reply for questions, recommendations, comparisons, and general help that do not ask to change the basket. Do not change the basket unless the user clearly asks. When a user requests a substitution for something already in current_cart, use replace_item to keep the replacement in the same list and preserve its quantity; use only products and group IDs from the supplied catalogue and basket. Check listed allergens before suggesting an allergy-safe alternative, and explain if the catalogue does not establish that it is safe. Use create_list when the user asks for a shopping list or asks to shop for a meal/event. Each item needs a catalog SKU and integer quantity from 1 to 20. A create_list must contain no more than 12 products and stay within the EUR budget. For remove_item and remove_list, use only IDs present in current_cart. If a removal target is ambiguous, ask a clarifying question with reply instead of guessing. For add_items, add to the manual basket group. The shopper may have selected allergies (user_allergies, using the catalogue allergen IDs). Never add, suggest, or substitute a product whose allergens or may-contain list includes any of them; mention the allergy when explaining choices, and say so when no safe option exists. Keep all user-facing text in English.',
          },
          {
            role: 'user',
            content: JSON.stringify({
              conversation_history: history,
              request: message,
              budget_eur: budget,
              user_allergies: allergies,
              catalog: productContext,
              current_cart: cartContext,
            }),
          },
        ],
      }),
    });
  } catch {
    throw new HttpError(502, 'The AI provider is unavailable.');
  }

  if (!response.ok) {
    throw new HttpError(502, `The AI provider returned HTTP ${response.status}.`);
  }

  let providerPayload;
  try {
    providerPayload = await response.json();
  } catch {
    throw new HttpError(502, 'The AI provider responded with invalid JSON.');
  }

  const content = providerPayload?.choices?.[0]?.message?.content;
  return validateAssistantAction(parseAssistantJson(content), budget, cart);
}

function contentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
  }[extension] || 'application/octet-stream';
}

function serveBuild(request, response) {
  if (!fs.existsSync(buildPath)) {
    sendJson(response, 404, { error: 'Production build not found. Run npm run build first.' });
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  } catch {
    sendJson(response, 400, { error: 'Invalid URL.' });
    return;
  }

  const requestedPath = path.resolve(buildPath, `.${pathname}`);
  if (requestedPath !== buildPath && !requestedPath.startsWith(`${buildPath}${path.sep}`)) {
    sendJson(response, 403, { error: 'Forbidden.' });
    return;
  }

  const candidate = fs.existsSync(requestedPath) && fs.statSync(requestedPath).isFile()
    ? requestedPath
    : path.join(buildPath, 'index.html');

  response.writeHead(200, {
    'Content-Type': contentType(candidate),
    'X-Content-Type-Options': 'nosniff',
  });
  fs.createReadStream(candidate).pipe(response);
}

const server = http.createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;

  if (pathname === '/api/health' && request.method === 'GET') {
    sendJson(response, 200, {
      status: 'ok',
      mode: process.env.AI_API_KEY ? 'provider' : 'demo',
    });
    return;
  }

  if (pathname === '/api/assistant/generate-plan' && request.method === 'POST') {
    try {
      const body = await readJsonBody(request);
      if (typeof body.message !== 'string' || !body.message.trim() || body.message.length > 1000) {
        throw new HttpError(400, 'Enter a request of up to 1,000 characters.');
      }

      const message = body.message.trim();
      const budget = budgetFrom(message, body.budget);
      const cart = validateCartSnapshot(body.cart);
      const history = validateConversationHistory(body.history);
      const allergies = validateAllergies(body.allergies);
      const mode = process.env.AI_API_KEY ? 'provider' : 'demo';
      const action = mode === 'provider'
        ? await createActionWithProvider(message, budget, cart, history, allergies)
        : validateAssistantAction(createDemoAction(message, budget, cart), budget, cart);
      const result = enforceAllergies(action, allergies);

      sendJson(response, 200, { mode, result });
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      if (status >= 500) console.error('Assistant API error:', error.message);
      sendJson(response, status, {
        error: error instanceof Error ? error.message : 'Unknown server error.',
      });
    }
    return;
  }

  if (pathname.startsWith('/api/')) {
    sendJson(response, 404, { error: 'API route not found.' });
    return;
  }

  if (request.method === 'GET' || request.method === 'HEAD') {
    serveBuild(request, response);
    return;
  }

  sendJson(response, 405, { error: 'Method not allowed.' });
});

const port = Number(process.env.PORT) || 5000;
server.listen(port, () => {
  console.log(`Delhaize API listening on http://localhost:${port}`);
  console.log(`Assistant mode: ${process.env.AI_API_KEY ? 'provider' : 'demo'}`);
});
