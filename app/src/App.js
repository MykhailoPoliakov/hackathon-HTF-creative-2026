import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './App.css';
import { sendShoppingCommand } from './services/assistant';

const CART_STORAGE_KEY = 'noir-market-cart-v1';
const FEATURED_SKUS = ['DH-11012', 'DH-70001', 'DH-40020', 'DH-12001'];
const ALLERGEN_LABELS = {
  gluten: 'Gluten',
  crustaceans: 'Crustaceans',
  eggs: 'Eggs',
  fish: 'Fish',
  peanuts: 'Peanuts',
  soybeans: 'Soy',
  milk: 'Milk',
  tree_nuts: 'Tree nuts',
  celery: 'Celery',
  mustard: 'Mustard',
  sesame: 'Sesame',
  sulphites: 'Sulphites',
  lupin: 'Lupin',
  molluscs: 'Molluscs',
};

const ALLERGY_STORAGE_KEY = 'delhaize-allergies-v1';

function loadAllergies() {
  try {
    const stored = JSON.parse(window.localStorage.getItem(ALLERGY_STORAGE_KEY) || '[]');
    return Array.isArray(stored) ? stored.filter((id) => id in ALLERGEN_LABELS) : [];
  } catch {
    return [];
  }
}

function allergyConflicts(product, allergies) {
  if (allergies.length === 0) return [];
  const listed = new Set([
    ...(product.allergenen?.bevat || []),
    ...(product.allergenen?.kan_bevatten || []),
  ]);
  return allergies.filter((id) => listed.has(id));
}

function conflictLabel(ids) {
  return ids.map((id) => ALLERGEN_LABELS[id] || id).join(', ');
}

function AllergyFilter({ allergies, onToggle, onClear }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    function closeOutside(event) {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    }
    function closeOnEscape(event) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('pointerdown', closeOutside);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  return (
    <div className="allergy-filter" ref={rootRef}>
      <button
        className={`allergy-filter__toggle${allergies.length ? ' has-selection' : ''}`}
        type="button"
        aria-expanded={open}
        aria-controls="allergy-panel"
        onClick={() => setOpen((current) => !current)}
      >
        Allergies
        {allergies.length > 0 && <span className="allergy-filter__count">{allergies.length}</span>}
      </button>
      {open && (
        <div className="allergy-filter__panel" id="allergy-panel" role="group" aria-label="My allergies">
          <div className="allergy-filter__heading">
            <strong>My allergies</strong>
            {allergies.length > 0 && (
              <button type="button" onClick={onClear}>Clear</button>
            )}
          </div>
          <div className="allergy-filter__options">
            {Object.entries(ALLERGEN_LABELS).map(([id, label]) => (
              <button
                className={`allergy-option${allergies.includes(id) ? ' is-selected' : ''}`}
                type="button"
                key={id}
                aria-pressed={allergies.includes(id)}
                onClick={() => onToggle(id)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function formatPrice(value) {
  if (!Number.isFinite(value)) return 'Price unavailable';
  return new Intl.NumberFormat('en-BE', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
  }).format(value);
}

function createManualGroup() {
  return { id: 'manual', type: 'manual', title: 'Manual items', items: [] };
}

function updateProductUrl(sku, replace = false) {
  const url = new URL(window.location.href);
  if (sku) url.searchParams.set('product', sku);
  else url.searchParams.delete('product');

  const method = replace ? 'replaceState' : 'pushState';
  window.history[method]({}, '', `${url.pathname}${url.search}${url.hash}`);
}

function loadCartGroups() {
  if (typeof window === 'undefined') return [createManualGroup()];

  try {
    const stored = JSON.parse(window.localStorage.getItem(CART_STORAGE_KEY) || 'null');
    if (!Array.isArray(stored)) return [createManualGroup()];

    const manual = stored.find((group) => group.id === 'manual');
    const plans = stored.filter(
      (group) =>
        group.id !== 'manual' &&
        group.type === 'plan' &&
        typeof group.title === 'string' &&
        Array.isArray(group.items),
    );

    return [
      {
        ...createManualGroup(),
        ...(manual || {}),
        items: Array.isArray(manual?.items) ? manual.items : [],
      },
      ...plans,
    ];
  } catch (error) {
    console.error('Could not restore the saved shopping basket:', error);
    return [createManualGroup()];
  }
}

function ProductImage({ product, className = '' }) {
  const [failed, setFailed] = useState(false);

  return (
    <div className={`product-image ${className}`}>
      {!failed && product.foto?.url ? (
        <img
          src={product.foto.url}
          alt={product.foto.alt || `Illustrative photo of ${product.product_naam}`}
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="product-image__fallback" aria-hidden="true">
          <span>D</span>
          <b>{product.product_naam?.slice(0, 1)}</b>
        </div>
      )}
      <span className="image-index">{product.sku}</span>
    </div>
  );
}

function ProductCard({ product, quantity, allergies, onOpen, onAdd, onQuantity, featured = false }) {
  const conflicts = allergyConflicts(product, allergies);
  return (
    <article className={`product-card${featured ? ' product-card--featured' : ''}${conflicts.length ? ' product-card--allergy' : ''}`}>
      <button
        className="product-card__visual"
        type="button"
        onClick={() => onOpen(product)}
        aria-label={`View ${product.product_naam}`}
      >
        <ProductImage product={product} />
        <span className="visual-open" aria-hidden="true">↗</span>
        {featured && <span className="featured-stamp">TOP PICK</span>}
        {conflicts.length > 0 && (
          <span className="allergy-flag">Allergy: {conflictLabel(conflicts)}</span>
        )}
      </button>
      <div className="product-card__content">
        <div className="product-card__eyebrow">
          <span>{product.categorie?.[0] || 'Selection'}</span>
          <span className="product-card__sku">{product.sku}</span>
        </div>
        <button className="product-card__name" type="button" onClick={() => onOpen(product)}>
          {product.product_naam}
        </button>
        <p className="product-card__description">{product.omschrijving}</p>
        <div className="product-card__bottom">
          <div>
            <strong>{formatPrice(product.prijs?.bedrag)}</strong>
            <span>{product.inhoud?.weergave}</span>
          </div>
          {quantity > 0 ? (
            <QuantityControl
              className="product-card__quantity"
              quantity={quantity}
              label={product.product_naam}
              onDecrease={() => onQuantity(-1)}
              onIncrease={() => onQuantity(1)}
            />
          ) : (
            <button
              className="add-button"
              type="button"
              aria-label={`Add ${product.product_naam} to basket`}
              onClick={() => onAdd(product)}
            >
              <span>+</span>
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

function QuantityControl({ quantity, onDecrease, onIncrease, label, className = '' }) {
  return (
    <div
      className={`quantity-control${className ? ` ${className}` : ''}`}
      role="group"
      aria-label={`Quantity of ${label}`}
    >
      <button
        type="button"
        onClick={onDecrease}
        aria-label={`Decrease quantity of ${label}`}
      >
        −
      </button>
      <span>{quantity}</span>
      <button
        type="button"
        onClick={onIncrease}
        aria-label={`Increase quantity of ${label}`}
      >
        +
      </button>
    </div>
  );
}

function CartDrawer({ groups, products, allergies, chatOpen, onClose, onQuantity, onRemoveProduct, onRemoveGroup, onClear }) {
  const [closing, setClosing] = useState(false);
  const productBySku = useMemo(
    () => new Map(products.map((product) => [product.sku, product])),
    [products],
  );
  const lines = groups.flatMap((group) =>
    group.items.map((item) => ({
      ...item,
      groupId: group.id,
      product: productBySku.get(item.sku),
    })),
  ).filter((item) => item.product);
  const total = lines.reduce(
    (sum, line) => sum + (line.product.prijs?.bedrag || 0) * line.quantity,
    0,
  );
  const quantityTotal = lines.reduce((sum, line) => sum + line.quantity, 0);

  const allergens = useMemo(() => {
    const contains = new Map();
    const mayContain = new Map();

    for (const line of lines) {
      for (const id of line.product.allergenen?.bevat || []) {
        if (!contains.has(id)) contains.set(id, new Set());
        contains.get(id).add(line.product.product_naam);
      }
      for (const id of line.product.allergenen?.kan_bevatten || []) {
        if (!mayContain.has(id)) mayContain.set(id, new Set());
        mayContain.get(id).add(line.product.product_naam);
      }
    }

    return { contains, mayContain };
  }, [lines]);

  const close = useCallback(() => setClosing(true), []);

  useEffect(() => {
    function closeOnEscape(event) {
      if (event.key === 'Escape') close();
    }
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [close]);

  function finishClose(event) {
    if (closing && event.animationName === 'drawer-out') onClose();
  }

  return (
    <div className={`drawer-layer${closing ? ' drawer-layer--closing' : ''}`}>
      <button className="drawer-backdrop" type="button" onClick={close} aria-label="Close basket" />
      <aside
        className={`cart-drawer cart-drawer--chat-visible${chatOpen ? ' cart-drawer--chat-open' : ''}${closing ? ' cart-drawer--closing' : ''}`}
        role="dialog"
        aria-modal={!chatOpen}
        aria-label="Shopping basket"
        data-testid="cart-drawer"
        onAnimationEnd={finishClose}
      >
        <header className="drawer-header">
          <div>
            <span className="eyebrow">YOUR SELECTION / {quantityTotal} ITEMS</span>
            <h2>Your basket<span className="accent-dot">.</span></h2>
          </div>
          <button className="icon-button" type="button" onClick={close} aria-label="Close basket">×</button>
        </header>

        <div className="cart-content">
          {lines.length === 0 ? (
            <div className="empty-state">
              <span className="empty-state__symbol">◌</span>
              <h3>Your basket is empty</h3>
              <p>Add products or ask the chat to build a separate shopping list.</p>
            </div>
          ) : (
            <>
              <section className="allergen-summary" aria-label="Allergens across all basket items">
                <div className="allergen-summary__heading">
                  <span className="section-code">ALLERGIES:</span>
                </div>
                {allergens.contains.size === 0 && allergens.mayContain.size === 0 ? (
                  <p className="allergen-none">No allergens are listed in the available data.</p>
                ) : (
                  <div className="allergen-chips">
                    {[...allergens.contains.keys()].map((id) => (
                      <span className="allergen-chip" key={`contains-${id}`}>
                        {ALLERGEN_LABELS[id] || id}
                      </span>
                    ))}
                    {[...allergens.mayContain.keys()].map((id) => (
                      <span className="allergen-chip allergen-chip--may" key={`may-contain-${id}`}>
                        May contain {ALLERGEN_LABELS[id] || id}
                      </span>
                    ))}
                  </div>
                )}
              </section>

              {groups.map((group) => {
                const groupLines = group.items
                  .map((item) => ({ ...item, product: productBySku.get(item.sku) }))
                  .filter((item) => item.product);
                if (groupLines.length === 0) return null;

                const groupTotal = groupLines.reduce(
                  (sum, item) => sum + (item.product.prijs?.bedrag || 0) * item.quantity,
                  0,
                );

                return (
                  <section className="cart-group" key={group.id}>
                    <div className="cart-group__heading">
                      <div>
                        <span className={`group-type${group.type === 'plan' ? ' group-type--ai' : ''}`}>
                          {group.type === 'plan' ? 'SHOPPING LIST' : 'MANUAL ITEMS'}
                        </span>
                        <h3>{group.title}</h3>
                      </div>
                      {group.type === 'plan' && (
                        <button
                          className="text-button text-button--danger"
                          type="button"
                          onClick={() => onRemoveGroup(group.id)}
                          aria-label={`Remove this shopping plan: ${group.title}`}
                        >
                          Remove plan
                        </button>
                      )}
                    </div>

                    <div className="cart-lines">
                      {groupLines.map(({ product, quantity }) => {
                        const conflicts = allergyConflicts(product, allergies);
                        return (
                        <div className={`cart-line${conflicts.length ? ' cart-line--allergy' : ''}`} key={`${group.id}-${product.sku}`}>
                          <ProductImage product={product} className="cart-line__image" />
                          <div className="cart-line__details">
                            <span className="cart-line__sku">{product.sku}</span>
                            <strong>{product.product_naam}</strong>
                            <span>{formatPrice(product.prijs?.bedrag)} · {product.inhoud?.weergave}</span>
                            {conflicts.length > 0 && (
                              <span className="cart-line__allergy">Allergy: {conflictLabel(conflicts)}</span>
                            )}
                          </div>
                          <div className="cart-line__actions">
                            <QuantityControl
                              quantity={quantity}
                              label={product.product_naam}
                              onDecrease={() => onQuantity(group.id, product.sku, -1)}
                              onIncrease={() => onQuantity(group.id, product.sku, 1)}
                            />
                            <button
                              className="remove-line"
                              type="button"
                              aria-label={`Remove ${product.product_naam}`}
                              onClick={() => onRemoveProduct(group.id, product.sku)}
                            >
                              ×
                            </button>
                          </div>
                        </div>
                        );
                      })}
                    </div>
                    <div className="cart-group__total">
                      <span>Subtotal</span>
                      <strong>{formatPrice(groupTotal)}</strong>
                    </div>
                  </section>
                );
              })}
              <button className="clear-basket-button" type="button" onClick={onClear}>
                Clear basket
              </button>
            </>
          )}
        </div>

        <footer className="cart-footer">
          <div className="cart-footer__total">
            <span>TOTAL · {quantityTotal} ITEMS</span>
            <strong>{formatPrice(total)}</strong>
          </div>
          <button
            className="delivery-button"
            type="button"
            disabled={quantityTotal === 0}
            title="Delivery checkout is not connected yet"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
              <path d="M3 6h11v11H3zM14 10h4l3 3v4h-7" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
              <circle cx="7.5" cy="18" r="1.8" stroke="currentColor" strokeWidth="1.7" />
              <circle cx="17.5" cy="18" r="1.8" stroke="currentColor" strokeWidth="1.7" />
            </svg>
            <span>Continue to delivery</span>
            <span className="delivery-button__arrow" aria-hidden="true">→</span>
          </button>
        </footer>
      </aside>
    </div>
  );
}

function ChatWidget({ open, basketOpen, onClose, onOpen, messages, busy, disabled, onSend, onOpenCart }) {
  const [draft, setDraft] = useState('');
  const [listening, setListening] = useState(false);
  const [voiceError, setVoiceError] = useState('');
  const recognitionRef = useRef(null);
  const scrollRef = useCallback((node) => {
    if (node) node.scrollTop = node.scrollHeight;
  }, []);

  useEffect(() => () => {
    const recognition = recognitionRef.current;
    if (recognition) {
      recognition.onend = null;
      recognition.onerror = null;
      recognition.abort();
    }
  }, []);

  function toggleVoiceInput() {
    onOpen();
    setVoiceError('');

    if (listening) {
      recognitionRef.current?.stop();
      return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setVoiceError('Voice input is not supported in this browser.');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => {
      const transcript = event.results?.[0]?.[0]?.transcript?.trim();
      if (transcript) {
        setDraft((current) => (current ? `${current.trimEnd()} ${transcript}` : transcript));
      }
    };
    recognition.onerror = async (event) => {
      if (event.error === 'aborted') {
        setListening(false);
        return;
      }

      let message = {
        'audio-capture': 'No microphone input is available. Check your selected input device.',
        network: 'The browser speech service could not connect. Check your internet connection and try again.',
        'no-speech': 'No speech detected. Check your microphone input and try again.',
        'service-not-allowed': 'Speech recognition is blocked by this browser or its settings.',
      }[event.error] || 'Voice input could not start. Please try again.';

      if (event.error === 'not-allowed') {
        let permissionState = 'unknown';
        try {
          permissionState = (await navigator.permissions?.query({ name: 'microphone' }))?.state || 'unknown';
        } catch (error) {
          console.warn('Could not check chat microphone permission:', error);
        }

        message = permissionState === 'denied'
          ? 'This site is blocked from using your microphone. Allow it in the browser site settings, then reload.'
          : permissionState === 'granted'
            ? 'Microphone access is granted, but this browser blocked speech recognition. Check its speech settings or try Chrome or Edge.'
            : 'Microphone access was denied. Check this site’s browser permission and your system microphone settings.';
      }

      setVoiceError(message);
      setListening(false);
    };
    recognition.onend = () => {
      setListening(false);
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    setListening(true);
    try {
      recognition.start();
    } catch (error) {
      console.error('Could not start chat voice input:', error);
      setVoiceError('Could not access voice input. Check microphone permissions and try again.');
      setListening(false);
      recognitionRef.current = null;
    }
  }

  function submit(event) {
    event.preventDefault();
    const value = draft.trim();
    if (!value || busy) return;
    recognitionRef.current?.abort();
    recognitionRef.current = null;
    setListening(false);
    setDraft('');
    onOpen();
    onSend(value);
  }

  return (
    <section
      className={`chat-dock${open ? ' chat-dock--open' : ''}${basketOpen ? ' chat-dock--basket-open' : ''}`}
      aria-label="Shopping chat"
    >
      {open && (
        <header className="chat-dock__header">
          <strong>Chat</strong>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Minimise chat">−</button>
        </header>
      )}
      {open && messages.length === 0 && (
        <div className="chat-welcome">
          <div>
            <strong>What can I help you find?</strong>
            <span>Ask about products, ingredients, meal ideas or your basket.</span>
          </div>
          <div className="chat-suggestions">
            {[
              'Recommend a quick dinner',
              'Compare two products',
              'Find a snack without nuts',
            ].map((suggestion) => (
              <button type="button" key={suggestion} onClick={() => onSend(suggestion)}>
                {suggestion}
              </button>
            ))}
          </div>
        </div>
      )}
      {open && (
        <div className="chat-messages" ref={scrollRef} aria-live="polite">
          {messages.map((message) => (
            <div className={`chat-message chat-message--${message.role}`} key={message.id}>
              <div className="chat-message__body">
                {message.text && <p>{message.text}</p>}
                {message.plan && (
                  <div className="plan-card">
                    <div className="plan-card__topline">
                      <span>{message.plan.title}</span>
                      <strong>{formatPrice(message.plan.total)}</strong>
                    </div>
                    {message.plan.summary && <p className="plan-card__summary">{message.plan.summary}</p>}
                    <div className="plan-card__items">
                      {message.plan.items.map((item) => {
                        const product = message.productsBySku?.[item.sku];
                        return (
                          <div className="plan-card__item" key={item.sku}>
                            <span>{item.quantity}×</span>
                            <strong>{product?.product_naam || item.sku}</strong>
                            <small>{formatPrice((product?.prijs?.bedrag || 0) * item.quantity)}</small>
                          </div>
                        );
                      })}
                    </div>
                    <button className="plan-card__action" type="button" onClick={onOpenCart}>
                      View basket
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
          {busy && <div className="chat-typing" role="status">Thinking…</div>}
          {voiceError && <p className="chat-voice-feedback" role="alert">{voiceError}</p>}
          {listening && <p className="chat-voice-feedback" role="status">Listening…</p>}
        </div>
      )}
      <form className="chat-composer" onSubmit={submit}>
        <label className="sr-only" htmlFor="chat-prompt">Message the shopping assistant</label>
        <input
          id="chat-prompt"
          type="text"
          value={draft}
          onFocus={disabled ? undefined : onOpen}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={disabled ? 'Loading products…' : 'Ask about products or your basket…'}
          disabled={disabled}
          maxLength={1000}
        />
        <button
          className={`chat-voice-button${listening ? ' is-listening' : ''}`}
          type="button"
          onClick={toggleVoiceInput}
          aria-label={listening ? 'Stop voice input' : 'Start voice input'}
          aria-pressed={listening}
          disabled={disabled || busy}
          title={listening ? 'Stop voice input' : 'Start voice input'}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
            <rect x="9" y="3" width="6" height="12" rx="3" stroke="currentColor" strokeWidth="1.8" />
            <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3m-3 0h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
        <button type="submit" disabled={!draft.trim() || busy || disabled} aria-label="Send message">
          {busy ? '…' : '↑'}
        </button>
      </form>
    </section>
  );
}

function ProductDetails({ product, quantity, allergies, onBack, onAdd, onQuantity }) {
  const nutrition = product.voedingswaarde || {};
  const conflicts = allergyConflicts(product, allergies);

  return (
    <section className="product-detail">
      <button className="back-link" type="button" onClick={onBack}>
        <span>←</span> BACK TO THE MARKET
      </button>
      <div className="product-detail__layout">
        <div className="product-detail__visual">
          <ProductImage product={product} />
        </div>
        <div className="product-detail__info">
          <div className="product-card__eyebrow">
            <span>{product.categorie?.join(' / ') || 'Selection'}</span>
            <span className="product-card__sku">{product.sku}</span>
          </div>
          <p className="eyebrow">{product.merk || 'Delhaize'}</p>
          <h1>{product.product_naam}</h1>
          {conflicts.length > 0 && (
            <p className="allergy-alert" role="alert">
              Not suitable for your allergies: {conflictLabel(conflicts)}
            </p>
          )}
          <p className="product-detail__description">{product.omschrijving}</p>
          <div className="detail-price-row">
            <strong>{formatPrice(product.prijs?.bedrag)}</strong>
            <span>{product.inhoud?.weergave}</span>
          </div>
          {quantity > 0 ? (
            <QuantityControl
              className="detail-quantity"
              quantity={quantity}
              label={product.product_naam}
              onDecrease={() => onQuantity(-1)}
              onIncrease={() => onQuantity(1)}
            />
          ) : (
            <button className="primary-button detail-add" type="button" onClick={() => onAdd(product)}>
              Add to basket <span>+</span>
            </button>
          )}

          <div className="detail-data-grid">
            <section>
              <span className="section-code">INGREDIENTS</span>
              <p>{product.ingredienten?.join(', ') || 'Information unavailable.'}</p>
            </section>
            <section>
              <span className="section-code">ALLERGENS</span>
              <p>
                {product.allergenen?.bevat?.length
                  ? product.allergenen.bevat.map((id) => ALLERGEN_LABELS[id] || id).join(', ')
                  : 'Not listed in the source data.'}
              </p>
              <small>Check the product packaging for current allergen information.</small>
            </section>
            <section>
              <span className="section-code">STORAGE</span>
              <p>{product.bewaren || 'No storage advice in the source data.'}</p>
            </section>
            <section>
              <span className="section-code">NUTRITION</span>
              <p>
                {nutrition.energie_kcal != null
                  ? `${nutrition.energie_kcal} kcal${nutrition.basis ? ` · ${nutrition.basis.replaceAll('_', ' ')}` : ''}`
                  : 'Not listed in the source data.'}
              </p>
            </section>
          </div>
        </div>
      </div>
    </section>
  );
}

function App() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [catalogError, setCatalogError] = useState('');
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('all');
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [cartGroups, setCartGroups] = useState(loadCartGroups);
  const [allergies, setAllergies] = useState(loadAllergies);
  const toggleAllergy = useCallback((id) => {
    setAllergies((current) => (current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]));
  }, []);
  useEffect(() => {
    window.localStorage.setItem(ALLERGY_STORAGE_KEY, JSON.stringify(allergies));
  }, [allergies]);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatBusy, setChatBusy] = useState(false);
  const [toast, setToast] = useState('');
  const [messages, setMessages] = useState([]);
  const productsBySku = useMemo(
    () => new Map(products.map((product) => [product.sku, product])),
    [products],
  );
  const manualQuantities = useMemo(() => {
    const manualGroup = cartGroups.find((group) => group.id === 'manual');
    return new Map((manualGroup?.items || []).map(({ sku, quantity }) => [sku, quantity]));
  }, [cartGroups]);

  useEffect(() => {
    let active = true;

    fetch('/products.json')
      .then((response) => {
        if (!response.ok) throw new Error(`Could not load catalogue (HTTP ${response.status}).`);
        return response.json();
      })
      .then((data) => {
        if (!Array.isArray(data)) throw new Error('The product catalogue has an invalid format.');
        if (active) setProducts(data);
      })
      .catch((error) => {
        console.error('Could not load the product catalog:', error);
        if (active) setCatalogError(error.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    function syncSelectedProduct() {
      const sku = new URLSearchParams(window.location.search).get('product');
      const product = sku ? productsBySku.get(sku) : null;
      setSelectedProduct(product || null);

      if (sku && productsBySku.size > 0 && !product) {
        updateProductUrl(null, true);
      }
    }

    window.addEventListener('popstate', syncSelectedProduct);
    syncSelectedProduct();
    return () => window.removeEventListener('popstate', syncSelectedProduct);
  }, [productsBySku]);

  useEffect(() => {
    try {
      window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cartGroups));
    } catch (error) {
      console.error('Could not persist the shopping basket:', error);
    }
  }, [cartGroups]);

  useEffect(() => {
    if (!toast) return undefined;
    const timeout = window.setTimeout(() => setToast(''), 2600);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const allProducts = useMemo(
    () => cartGroups.flatMap((group) => group.items),
    [cartGroups],
  );
  const totalCount = allProducts.reduce((sum, item) => sum + item.quantity, 0);
  const totalPrice = allProducts.reduce(
    (sum, item) => sum + (productsBySku.get(item.sku)?.prijs?.bedrag || 0) * item.quantity,
    0,
  );

  const categories = useMemo(() => {
    const unique = [...new Set(products.map((product) => product.categorie?.[0]).filter(Boolean))];
    return ['all', ...unique];
  }, [products]);

  const filteredProducts = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase();
    return products.filter((product) => {
      const matchesCategory =
        activeCategory === 'all' || product.categorie?.[0] === activeCategory;
      const searchable = [
        product.product_naam,
        product.merk,
        ...(product.categorie || []),
        ...(product.ingredienten || []),
      ]
        .join(' ')
        .toLocaleLowerCase();
      return matchesCategory && (!normalizedSearch || searchable.includes(normalizedSearch));
    });
  }, [activeCategory, products, search]);

  const featuredProducts = useMemo(
    () =>
      FEATURED_SKUS.map((sku) => productsBySku.get(sku)).filter(Boolean),
    [productsBySku],
  );
  const displayProducts = useMemo(() => {
    if (search || activeCategory !== 'all') return filteredProducts;
    const featuredSet = new Set(featuredProducts.map((product) => product.sku));
    return [
      ...featuredProducts,
      ...filteredProducts.filter((product) => !featuredSet.has(product.sku)),
    ];
  }, [activeCategory, featuredProducts, filteredProducts, search]);

  const showToast = useCallback((message) => setToast(message), []);

  const addManualProduct = useCallback((product) => {
    setCartGroups((current) =>
      current.map((group) => {
        if (group.id !== 'manual') return group;
        const existing = group.items.find((item) => item.sku === product.sku);
        return {
          ...group,
          items: existing
            ? group.items.map((item) =>
                item.sku === product.sku ? { ...item, quantity: item.quantity + 1 } : item,
              )
            : [...group.items, { sku: product.sku, quantity: 1 }],
        };
      }),
    );
    showToast(`${product.product_naam} added to manual items`);
  }, [showToast]);

  const updateQuantity = useCallback((groupId, sku, difference) => {
    setCartGroups((current) =>
      current
        .map((group) => {
          if (group.id !== groupId) return group;
          return {
            ...group,
            items: group.items
              .map((item) =>
                item.sku === sku ? { ...item, quantity: item.quantity + difference } : item,
              )
              .filter((item) => item.quantity > 0),
          };
        })
        .filter((group) => group.id === 'manual' || group.items.length > 0),
    );
  }, []);

  const removeProduct = useCallback((groupId, sku) => {
    setCartGroups((current) =>
      current
        .map((group) =>
          group.id === groupId
            ? { ...group, items: group.items.filter((item) => item.sku !== sku) }
            : group,
        )
        .filter((group) => group.id === 'manual' || group.items.length > 0),
    );
  }, []);

  const removeGroup = useCallback((groupId) => {
    if (groupId === 'manual') {
      setCartGroups((current) =>
        current.map((group) => (group.id === 'manual' ? { ...group, items: [] } : group)),
      );
      return;
    }
    setCartGroups((current) => current.filter((group) => group.id !== groupId));
  }, []);

  const clearBasket = useCallback(() => {
    setCartGroups((current) => current.some((group) => group.id === 'manual')
      ? current.filter((group) => group.id === 'manual').map((group) => ({ ...group, items: [] }))
      : [createManualGroup()]);
  }, []);

  const submitChat = useCallback(async (text) => {
    if (chatBusy) return;
    const userMessage = { id: `user-${Date.now()}`, role: 'user', text };
    const history = messages
      .filter((message) => message.role === 'user' || message.role === 'assistant')
      .slice(-12)
      .map(({ role, text: messageText }) => ({ role, text: messageText }));
    setMessages((current) => [...current, userMessage]);
    setChatBusy(true);
    setChatOpen(true);

    try {
      const cart = cartGroups.map((group) => ({
        id: group.id,
        type: group.type,
        title: group.title,
        items: group.items.map(({ sku, quantity }) => ({ sku, quantity })),
      }));
      const response = await sendShoppingCommand({ message: text, budget: 30, cart, history, allergies });
      const result = response.result;
      const validItems = (items) => items.map((item) => {
        if (!productsBySku.has(item.sku) || !Number.isInteger(item.quantity) || item.quantity < 1) {
          throw new Error('The assistant returned a product that is not in the catalogue.');
        }
        return { sku: item.sku, quantity: item.quantity };
      });

      if (result.action === 'create_list') {
        const items = validItems(result.items);
        const group = {
          id: `plan-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          type: 'plan',
          title: result.title,
          items,
        };
        setCartGroups((current) => [...current, group]);
      } else if (result.action === 'add_items') {
        const items = validItems(result.items);
        setCartGroups((current) => current.map((group) => {
          if (group.id !== 'manual') return group;
          const nextItems = group.items.map((item) => ({ ...item }));
          for (const item of items) {
            const existing = nextItems.find((entry) => entry.sku === item.sku);
            if (existing) existing.quantity += item.quantity;
            else nextItems.push(item);
          }
          return { ...group, items: nextItems };
        }));
      } else if (result.action === 'remove_item') {
        removeProduct(result.group_id, result.sku);
      } else if (result.action === 'replace_item') {
        if (
          !productsBySku.has(result.remove_sku) ||
          !productsBySku.has(result.add_sku) ||
          !Number.isInteger(result.quantity) ||
          result.quantity < 1
        ) {
          throw new Error('The assistant returned an invalid product substitution.');
        }
        setCartGroups((current) => current.map((group) => {
          if (group.id !== result.group_id) return group;
          const nextItems = group.items.filter((item) => item.sku !== result.remove_sku);
          const replacement = nextItems.find((item) => item.sku === result.add_sku);
          if (replacement) replacement.quantity += result.quantity;
          else nextItems.push({ sku: result.add_sku, quantity: result.quantity });
          return { ...group, items: nextItems };
        }));
      } else if (result.action === 'remove_list') {
        removeGroup(result.group_id);
      } else if (result.action === 'clear_basket') {
        clearBasket();
      }

      setMessages((current) => [
        ...current,
        {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          text: result.message,
          plan: result.action === 'create_list' ? result : null,
          productsBySku: Object.fromEntries(productsBySku),
        },
      ]);
    } catch (error) {
      console.error('Could not process the shopping chat request:', error);
      setMessages((current) => [
        ...current,
        {
          id: `error-${Date.now()}`,
          role: 'assistant',
          text: `I couldn't update your basket: ${error.message}`,
          error: true,
        },
      ]);
    } finally {
      setChatBusy(false);
    }
  }, [allergies, cartGroups, chatBusy, clearBasket, messages, productsBySku, removeGroup, removeProduct]);

  function openCatalog() {
    updateProductUrl(null, true);
    setSelectedProduct(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function openProduct(product) {
    updateProductUrl(product.sku);
    setSelectedProduct(product);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function searchCatalog(value) {
    updateProductUrl(null, true);
    setSearch(value);
    setSelectedProduct(null);
  }

  return (
    <div className="app-shell">
      <header className="site-header">
        <div className="site-header__inner">
          <a className="brand-lockup" href="#top" onClick={openCatalog} aria-label="Delhaize home">
            <span className="brand-mark">D</span>
            <strong>Delhaize</strong>
          </a>
          <label className="search-field">
            <span className="search-icon" aria-hidden="true">⌕</span>
            <span className="sr-only">Search products</span>
            <input
              type="search"
              value={search}
              onChange={(event) => searchCatalog(event.target.value)}
              placeholder="Search products"
            />
            {search && (
              <button type="button" className="search-clear" onClick={() => searchCatalog('')} aria-label="Clear search">
                ×
              </button>
            )}
          </label>
          <button
            className="cart-trigger"
            type="button"
            aria-label={`Open basket, ${totalCount} items`}
            onClick={() => setCartOpen(true)}
          >
            <span className="cart-trigger__label">Basket</span>
            <strong>{formatPrice(totalPrice)}</strong>
            <span className="cart-trigger__count">{totalCount}</span>
          </button>
        </div>
      </header>

      <main id="top">
        {selectedProduct ? (
          <ProductDetails
            product={selectedProduct}
            quantity={manualQuantities.get(selectedProduct.sku) || 0}
            allergies={allergies}
            onBack={openCatalog}
            onAdd={addManualProduct}
            onQuantity={(difference) => updateQuantity('manual', selectedProduct.sku, difference)}
          />
        ) : (
          <section className="catalog-section" id="catalog">
            <div className="catalog-topline">
              <h1>Groceries</h1>
              <div className="catalog-topline__meta">
                <span>{products.length} products</span>
                <AllergyFilter
                  allergies={allergies}
                  onToggle={toggleAllergy}
                  onClear={() => setAllergies([])}
                />
              </div>
            </div>
            <div className="category-scroller" aria-label="Filter by category">
              {categories.map((category) => (
                <button
                  className={`category-chip${activeCategory === category ? ' is-active' : ''}`}
                  type="button"
                  key={category}
                  onClick={() => {
                    updateProductUrl(null, true);
                    setActiveCategory(category);
                    setSelectedProduct(null);
                  }}
                >
                  {category === 'all' ? 'All' : category}
                </button>
              ))}
            </div>

            {loading ? (
              <div className="catalog-message">Loading products…</div>
            ) : catalogError ? (
              <div className="catalog-error" role="alert">
                <strong>Products are unavailable</strong>
                <p>{catalogError}</p>
                <p>Check that public/products.json exists, then reload the page.</p>
              </div>
            ) : displayProducts.length === 0 ? (
              <div className="empty-search">
                <strong>No products found</strong>
                <p>Try a different search or category.</p>
                <button type="button" onClick={() => { setSearch(''); setActiveCategory('all'); }}>
                  Clear filters
                </button>
              </div>
            ) : (
              <div className="product-grid">
                {displayProducts.map((product) => (
                  <ProductCard
                    key={product.sku}
                    product={product}
                    quantity={manualQuantities.get(product.sku) || 0}
                    allergies={allergies}
                    featured={!search && activeCategory === 'all' && FEATURED_SKUS.includes(product.sku)}
                    onOpen={openProduct}
                    onAdd={addManualProduct}
                    onQuantity={(difference) => updateQuantity('manual', product.sku, difference)}
                  />
                ))}
              </div>
            )}
          </section>
        )}
      </main>

      <ChatWidget
        open={chatOpen}
        basketOpen={cartOpen}
        onOpen={() => setChatOpen(true)}
        onClose={() => setChatOpen(false)}
        messages={messages}
        busy={chatBusy}
        disabled={loading || Boolean(catalogError)}
        onSend={submitChat}
        onOpenCart={() => setCartOpen(true)}
      />

      {cartOpen && (
        <CartDrawer
          groups={cartGroups}
          products={products}
          allergies={allergies}
          chatOpen={chatOpen}
          onClose={() => setCartOpen(false)}
          onQuantity={updateQuantity}
          onRemoveProduct={removeProduct}
          onRemoveGroup={removeGroup}
          onClear={clearBasket}
        />
      )}

      {toast && <div className="toast-message" role="status">{toast}</div>}
    </div>
  );
}

export default App;
