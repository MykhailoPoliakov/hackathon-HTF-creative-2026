export async function sendShoppingCommand({ message, budget, cart, history = [], allergies = [] }) {
  let response;
  try {
    response = await fetch('/api/assistant/generate-plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, budget, cart, history, allergies }),
    });
  } catch {
    throw new Error('Could not connect to the Delhaize API. Make sure it is running on port 5000.');
  }

  let responseText;
  try {
    responseText = await response.text();
  } catch {
    throw new Error(`Could not read the AI server response (HTTP ${response.status}).`);
  }

  let payload;
  try {
    payload = JSON.parse(responseText);
  } catch {
    throw new Error(
      `The AI server returned a non-JSON response (HTTP ${response.status}). Check the API connection on port 5000.`,
    );
  }

  if (!response.ok) {
    throw new Error(payload?.error || 'Your basket could not be updated.');
  }

  const supportedActions = new Set([
    'create_list',
    'add_items',
    'remove_item',
    'replace_item',
    'remove_list',
    'clear_basket',
    'reply',
  ]);
  if (!payload?.result || !supportedActions.has(payload.result.action)) {
    throw new Error('The AI server returned an invalid basket action.');
  }

  return payload;
}
