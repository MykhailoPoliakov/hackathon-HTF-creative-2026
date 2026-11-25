import { act, fireEvent, render, screen, within } from '@testing-library/react';
import App from './App';
import { sendShoppingCommand } from './services/assistant';

jest.mock('./services/assistant', () => ({
  sendShoppingCommand: jest.fn(),
}));

const products = [
  {
    sku: 'DH-11012',
    product_naam: 'Pesto alla Genovese',
    merk: 'Delhaize',
    inhoud: { weergave: '190 g' },
    prijs: { bedrag: 2.79 },
    categorie: ['Food', 'Sauces', 'Pesto'],
    omschrijving: 'Pesto with basil and Italian cheese.',
    ingredienten: ['basil', 'cashews'],
    allergenen: { bevat: ['milk', 'tree_nuts'], kan_bevatten: null },
    foto: { url: null, alt: 'Illustrative photo of pesto.' },
  },
  {
    sku: 'DH-10041',
    product_naam: 'Spaghetti No. 5',
    merk: 'Delhaize',
    inhoud: { weergave: '500 g' },
    prijs: { bedrag: 1.19 },
    categorie: ['Food', 'Pasta and rice', 'Pasta'],
    omschrijving: 'Classic spaghetti made with durum wheat semolina.',
    ingredienten: ['durum wheat semolina', 'water'],
    allergenen: { bevat: ['gluten'], kan_bevatten: null },
    foto: { url: null, alt: 'Illustrative photo of spaghetti.' },
  },
  {
    sku: 'DH-40001',
    product_naam: 'Semi-skimmed milk',
    merk: 'Delhaize',
    inhoud: { weergave: '1 L' },
    prijs: { bedrag: 1.29 },
    categorie: ['Dairy'],
    omschrijving: 'Semi-skimmed milk.',
    ingredienten: ['semi-skimmed milk'],
    allergenen: { bevat: ['milk'], kan_bevatten: null },
    foto: { url: null, alt: 'Illustrative photo of milk.' },
  },
  {
    sku: 'DH-40020',
    product_naam: 'Oat drink',
    merk: 'Delhaize',
    inhoud: { weergave: '1 L' },
    prijs: { bedrag: 1.99 },
    categorie: ['Dairy alternatives'],
    omschrijving: 'Oat drink.',
    ingredienten: ['water', 'oats'],
    allergenen: { bevat: ['gluten'], kan_bevatten: null },
    foto: { url: null, alt: 'Illustrative photo of oat drink.' },
  },
];

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState({}, '', '/');
  window.scrollTo = jest.fn();
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => products,
  });
  sendShoppingCommand.mockReset();
});

test('opening a product supports browser back navigation', async () => {
  render(<App />);

  fireEvent.click(await screen.findByRole('button', { name: 'View Pesto alla Genovese' }));
  expect(window.location.search).toBe('?product=DH-11012');
  expect(screen.getByRole('heading', { name: 'Pesto alla Genovese' })).toBeInTheDocument();

  await act(async () => {
    window.history.replaceState({}, '', '/');
    fireEvent.popState(window);
  });

  expect(window.location.search).toBe('');
  expect(screen.getByRole('heading', { name: 'Groceries' })).toBeInTheDocument();
});

test('manual product quantities stay in sync between the catalogue and product page', async () => {
  render(<App />);

  fireEvent.click(await screen.findByRole('button', { name: 'Add Pesto alla Genovese to basket' }));
  let quantity = screen.getByRole('group', { name: 'Quantity of Pesto alla Genovese' });
  expect(within(quantity).getByText('1')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'View Pesto alla Genovese' }));
  quantity = screen.getByRole('group', { name: 'Quantity of Pesto alla Genovese' });
  expect(within(quantity).getByText('1')).toBeInTheDocument();
  fireEvent.click(within(quantity).getByRole('button', { name: 'Increase quantity of Pesto alla Genovese' }));
  expect(within(screen.getByRole('group', { name: 'Quantity of Pesto alla Genovese' })).getByText('2'))
    .toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: /BACK TO THE MARKET/ }));
  quantity = screen.getByRole('group', { name: 'Quantity of Pesto alla Genovese' });
  expect(within(quantity).getByText('2')).toBeInTheDocument();
  fireEvent.click(within(quantity).getByRole('button', { name: 'Decrease quantity of Pesto alla Genovese' }));
  expect(within(screen.getByRole('group', { name: 'Quantity of Pesto alla Genovese' })).getByText('1'))
    .toBeInTheDocument();
});

test('refreshing a product URL restores its detail page', async () => {
  window.history.replaceState({}, '', '/?product=DH-11012');
  expect(window.location.search).toBe('?product=DH-11012');
  render(<App />);

  expect(await screen.findByRole('heading', { name: 'Pesto alla Genovese' })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Groceries' })).not.toBeInTheDocument();
});

test('renders the English catalogue and combines allergens in the basket', async () => {
  render(<App />);

  expect(await screen.findByRole('heading', { name: 'Groceries' })).toBeInTheDocument();
  expect(await screen.findByText('Pesto with basil and Italian cheese.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Add Pesto alla Genovese to basket' }));
  fireEvent.click(screen.getByRole('button', { name: 'Open basket, 1 items' }));

  const basket = screen.getByTestId('cart-drawer');
  expect(within(basket).getByText('ALLERGIES:')).toBeInTheDocument();
  expect(within(basket).getByText('Milk', { exact: true })).toBeInTheDocument();
  expect(within(basket).getByText('Tree nuts', { exact: true })).toBeInTheDocument();
  expect(within(basket).queryByText(/check product packaging/i)).not.toBeInTheDocument();
  expect(within(basket).getByText('MANUAL ITEMS')).toBeInTheDocument();
});

test('removing an assistant plan leaves manually added products untouched', async () => {
  sendShoppingCommand.mockResolvedValue({
    mode: 'demo',
    result: {
      action: 'create_list',
      title: 'Pasta Bolognese',
      summary: 'A separate pasta shopping list.',
      items: [{ sku: 'DH-10041', quantity: 1, reason: 'Pasta base.' }],
      total: 1.19,
      message: 'Added "Pasta Bolognese" as a separate shopping list.',
    },
  });
  render(<App />);

  fireEvent.click(await screen.findByRole('button', { name: 'Add Pesto alla Genovese to basket' }));
  const prompt = screen.getByLabelText('Message the shopping assistant');
  fireEvent.change(prompt, {
    target: { value: 'Plan pasta Bolognese' },
  });
  fireEvent.submit(prompt.closest('form'));

  expect(await screen.findByText('Added "Pasta Bolognese" as a separate shopping list.'))
    .toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Open basket, 2 items' }));

  const basket = screen.getByTestId('cart-drawer');
  expect(within(basket).getByText('Pesto alla Genovese')).toBeInTheDocument();
  expect(within(basket).getByText('Spaghetti No. 5')).toBeInTheDocument();
  fireEvent.click(within(basket).getByRole('button', { name: 'Remove this shopping plan: Pasta Bolognese' }));

  expect(within(basket).getByText('Pesto alla Genovese')).toBeInTheDocument();
  expect(within(basket).queryByText('Spaghetti No. 5')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Open basket, 1 items' })).toBeInTheDocument();
});

test('chat requests can add and remove an individual product', async () => {
  sendShoppingCommand
    .mockResolvedValueOnce({
      result: {
        action: 'add_items',
        items: [{ sku: 'DH-10041', quantity: 1 }],
        message: 'Added Spaghetti No. 5 to your basket.',
      },
    })
    .mockResolvedValueOnce({
      result: {
        action: 'remove_item',
        group_id: 'manual',
        sku: 'DH-10041',
        message: 'Removed Spaghetti No. 5 from your basket.',
      },
    });
  render(<App />);

  await screen.findByRole('button', { name: 'Add Spaghetti No. 5 to basket' });
  const prompt = screen.getByLabelText('Message the shopping assistant');
  fireEvent.change(prompt, { target: { value: 'Add spaghetti' } });
  fireEvent.submit(prompt.closest('form'));
  expect(await screen.findByText('Added Spaghetti No. 5 to your basket.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Open basket, 1 items' })).toBeInTheDocument();

  fireEvent.change(prompt, { target: { value: 'Remove spaghetti' } });
  fireEvent.submit(prompt.closest('form'));
  expect(await screen.findByText('Removed Spaghetti No. 5 from your basket.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Open basket, 0 items' })).toBeInTheDocument();
});

test('chat answers product questions and includes prior turns without changing the basket', async () => {
  sendShoppingCommand
    .mockResolvedValueOnce({
      result: {
        action: 'reply',
        message: 'Spaghetti contains gluten; pesto contains milk and tree nuts.',
      },
    })
    .mockResolvedValueOnce({
      result: {
        action: 'reply',
        message: 'The spaghetti is the simpler choice if you want to avoid milk and nuts.',
      },
    });
  render(<App />);

  const prompt = screen.getByLabelText('Message the shopping assistant');
  fireEvent.change(prompt, { target: { value: 'Which pasta has fewer allergens?' } });
  fireEvent.submit(prompt.closest('form'));
  expect(await screen.findByText('Spaghetti contains gluten; pesto contains milk and tree nuts.'))
    .toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Open basket, 0 items' })).toBeInTheDocument();

  fireEvent.change(prompt, { target: { value: 'Which one avoids milk and nuts?' } });
  fireEvent.submit(prompt.closest('form'));
  expect(await screen.findByText('The spaghetti is the simpler choice if you want to avoid milk and nuts.'))
    .toBeInTheDocument();
  expect(sendShoppingCommand).toHaveBeenNthCalledWith(2, expect.objectContaining({
    history: [
      { role: 'user', text: 'Which pasta has fewer allergens?' },
      { role: 'assistant', text: 'Spaghetti contains gluten; pesto contains milk and tree nuts.' },
    ],
  }));
});

test('allergy selection marks matching products, persists, and is sent to the assistant', async () => {
  sendShoppingCommand.mockResolvedValue({ result: { action: 'reply', message: 'Noted.' } });
  render(<App />);

  await screen.findByRole('button', { name: 'View Pesto alla Genovese' });
  fireEvent.click(screen.getByRole('button', { name: /^Allergies/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Milk' }));

  expect(screen.getAllByText('Allergy: Milk').length).toBeGreaterThanOrEqual(2);
  expect(JSON.parse(window.localStorage.getItem('delhaize-allergies-v1'))).toEqual(['milk']);

  const prompt = screen.getByLabelText('Message the shopping assistant');
  fireEvent.change(prompt, { target: { value: 'Add pasta' } });
  fireEvent.submit(prompt.closest('form'));
  await screen.findByText('Noted.');
  expect(sendShoppingCommand).toHaveBeenCalledWith(expect.objectContaining({ allergies: ['milk'] }));
});

test('chat can replace a basket item while the basket is open', async () => {
  sendShoppingCommand.mockResolvedValue({
    result: {
      action: 'replace_item',
      group_id: 'manual',
      remove_sku: 'DH-40001',
      add_sku: 'DH-40020',
      quantity: 1,
      message: 'Swapped semi-skimmed milk for oat drink.',
    },
  });
  render(<App />);

  fireEvent.click(await screen.findByRole('button', { name: 'Add Semi-skimmed milk to basket' }));
  fireEvent.click(screen.getByRole('button', { name: 'Open basket, 1 items' }));

  const basket = screen.getByTestId('cart-drawer');
  const prompt = screen.getByLabelText('Message the shopping assistant');
  fireEvent.focus(prompt);
  expect(screen.getByLabelText('Shopping chat')).toHaveClass('chat-dock--open', 'chat-dock--basket-open');
  expect(basket).toHaveClass('cart-drawer--chat-visible', 'cart-drawer--chat-open');
  fireEvent.change(prompt, {
    target: { value: 'I have a lactose allergy; swap my milk for oat milk.' },
  });
  fireEvent.submit(prompt.closest('form'));

  expect(await screen.findByText('Swapped semi-skimmed milk for oat drink.')).toBeInTheDocument();
  expect(within(basket).getByText('Oat drink')).toBeInTheDocument();
  expect(within(basket).queryByText('Semi-skimmed milk')).not.toBeInTheDocument();
});

test('voice input adds a recognized transcript to the chat draft', async () => {
  const recognition = {
    start: jest.fn(),
    stop: jest.fn(),
    abort: jest.fn(),
  };
  const originalDescriptor = Object.getOwnPropertyDescriptor(window, 'SpeechRecognition');
  Object.defineProperty(window, 'SpeechRecognition', {
    configurable: true,
    value: jest.fn(() => recognition),
  });

  render(<App />);
  await screen.findByRole('button', { name: 'Add Pesto alla Genovese to basket' });
  fireEvent.click(screen.getByRole('button', { name: 'Start voice input' }));

  expect(recognition.start).toHaveBeenCalledTimes(1);
  const prompt = screen.getByLabelText('Message the shopping assistant');
  act(() => recognition.onresult({ results: [[{ transcript: 'Add pesto to my basket' }]] }));
  expect(prompt).toHaveValue('Add pesto to my basket');

  if (originalDescriptor) {
    Object.defineProperty(window, 'SpeechRecognition', originalDescriptor);
  } else {
    delete window.SpeechRecognition;
  }
});

test('voice input explains when speech recognition is unavailable', async () => {
  render(<App />);
  await screen.findByRole('button', { name: 'Add Pesto alla Genovese to basket' });

  fireEvent.click(screen.getByRole('button', { name: 'Start voice input' }));

  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent(
    'Voice input is not supported in this browser.',
  );
  expect(alert.parentElement).toHaveClass('chat-messages');
});

test('voice input distinguishes granted microphone access from blocked speech recognition', async () => {
  const recognition = {
    start: jest.fn(),
    stop: jest.fn(),
    abort: jest.fn(),
  };
  const speechDescriptor = Object.getOwnPropertyDescriptor(window, 'SpeechRecognition');
  const permissionsDescriptor = Object.getOwnPropertyDescriptor(navigator, 'permissions');
  Object.defineProperty(window, 'SpeechRecognition', {
    configurable: true,
    value: jest.fn(() => recognition),
  });
  Object.defineProperty(navigator, 'permissions', {
    configurable: true,
    value: { query: jest.fn().mockResolvedValue({ state: 'granted' }) },
  });

  render(<App />);
  await screen.findByRole('button', { name: 'Add Pesto alla Genovese to basket' });
  fireEvent.click(screen.getByRole('button', { name: 'Start voice input' }));

  await act(async () => {
    await recognition.onerror({ error: 'not-allowed' });
  });
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Microphone access is granted, but this browser blocked speech recognition.',
  );

  if (speechDescriptor) {
    Object.defineProperty(window, 'SpeechRecognition', speechDescriptor);
  } else {
    delete window.SpeechRecognition;
  }
  if (permissionsDescriptor) {
    Object.defineProperty(navigator, 'permissions', permissionsDescriptor);
  } else {
    delete navigator.permissions;
  }
});

test('clearing the basket immediately removes its items', async () => {
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Add Pesto alla Genovese to basket' }));
  fireEvent.click(screen.getByRole('button', { name: 'Add Spaghetti No. 5 to basket' }));
  fireEvent.click(screen.getByRole('button', { name: 'Open basket, 2 items' }));
  expect(screen.getByRole('button', { name: 'Continue to delivery' })).toBeEnabled();

  const basket = screen.getByTestId('cart-drawer');
  const clearButton = within(basket).getByRole('button', { name: 'Clear basket' });
  expect(clearButton.closest('.cart-content')).toBeInTheDocument();
  fireEvent.click(clearButton);

  expect(screen.getByText('Your basket is empty')).toBeInTheDocument();
  expect(within(basket).queryByRole('button', { name: 'Clear basket' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Continue to delivery' })).toBeDisabled();
});
