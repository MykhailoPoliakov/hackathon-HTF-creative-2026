import { sendShoppingCommand } from './assistant';

beforeEach(() => {
  global.fetch = jest.fn();
});

test('sends conversation history and accepts conversational replies', async () => {
  global.fetch.mockResolvedValue({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({
      mode: 'provider',
      result: { action: 'reply', message: 'Spaghetti contains gluten.' },
    }),
  });

  const history = [{ role: 'user', text: 'Which pasta is gluten-free?' }];
  const response = await sendShoppingCommand({
    message: 'Show me alternatives.',
    budget: 30,
    cart: [],
    history,
  });

  expect(response.result.action).toBe('reply');
  expect(JSON.parse(global.fetch.mock.calls[0][1].body).history).toEqual(history);
});

test('accepts validated product substitutions from the API', async () => {
  global.fetch.mockResolvedValue({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({
      result: {
        action: 'replace_item',
        group_id: 'manual',
        remove_sku: 'DH-40001',
        add_sku: 'DH-40020',
        quantity: 1,
        message: 'Swapped milk for oat drink.',
      },
    }),
  });

  const response = await sendShoppingCommand({ message: 'Swap milk for oat drink.', budget: 30, cart: [] });

  expect(response.result.action).toBe('replace_item');
});

test('reports non-JSON API responses with their HTTP status', async () => {
  global.fetch.mockResolvedValue({
    ok: true,
    status: 200,
    text: async () => '<!doctype html><title>Delhaize</title>',
  });

  await expect(sendShoppingCommand({ message: 'Help', budget: 30, cart: [] }))
    .rejects.toThrow('non-JSON response (HTTP 200)');
});

test('explains when the API cannot be reached', async () => {
  global.fetch.mockRejectedValue(new Error('Failed to fetch'));

  await expect(sendShoppingCommand({ message: 'Help', budget: 30, cart: [] }))
    .rejects.toThrow('Make sure it is running on port 5000.');
});
