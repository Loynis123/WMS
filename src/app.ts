
/* ====================================================================== *
 * 1. МОДЕЛИ                                                              *
 * ====================================================================== */

/**
 * ООП: АБСТРАКЦИЯ + ИНКАПСУЛЯЦИЯ.
 * Базовый абстрактный класс всех сущностей. `id` доступен только на чтение,
 * создать Entity напрямую нельзя — только через наследников.
 * SOLID — LSP: любой наследник может использоваться вместо Entity.
 */
abstract class Entity {
  protected constructor(private readonly _id: string) {}

  public get id(): string {
    return this._id;
  }

  /** Полиморфный метод: каждый наследник описывает себя по-своему. */
  public abstract describe(): string;
}

/**
 * ООП: НАСЛЕДОВАНИЕ и ПОЛИМОРФИЗМ (переопределяет describe()).
 * Товар идентифицируется по SKU — стандартный артикул в WMS и e-commerce.
 */
class Product extends Entity {
  constructor(
    public readonly sku: string,
    public readonly name: string,
    public readonly category: string,
    public readonly price: number
  ) {
    super(sku);
  }

  public override describe(): string {
    return `${this.name} (SKU: ${this.sku}, ${this.price.toLocaleString('ru-RU')} ₽)`;
  }
}

/**
 * Складская позиция: остаток товара в конкретной ячейке хранения.
 * ООП: ИНКАПСУЛЯЦИЯ — количества меняются только через методы с проверкой
 * инвариантов (нельзя зарезервировать больше доступного, уйти в минус).
 */
class InventoryItem extends Entity {
  private _onHand: number; // физически лежит в ячейке
  private _reserved: number; // зарезервировано под заказы, ещё не отгружено

  constructor(
    public readonly sku: string,
    public readonly location: string, // адрес ячейки, напр. "A-01-01"
    onHand: number = 0
  ) {
    super(`${sku}@${location}`);
    this._onHand = onHand;
    this._reserved = 0;
  }

  public get onHand(): number {
    return this._onHand;
  }

  public get reserved(): number {
    return this._reserved;
  }

  /** Свободный к продаже остаток. */
  public get available(): number {
    return this._onHand - this._reserved;
  }

  /** Приёмка: увеличение остатка. */
  public receive(quantity: number): void {
    this.assertPositive(quantity);
    this._onHand += quantity;
  }

  /** Резервирование под заказ. true, если хватило свободного остатка. */
  public reserve(quantity: number): boolean {
    this.assertPositive(quantity);
    if (quantity > this.available) return false;
    this._reserved += quantity;
    return true;
  }

  /** Отгрузка зарезервированного товара (списание с остатка). */
  public ship(quantity: number): void {
    this.assertPositive(quantity);
    if (quantity > this._reserved || quantity > this._onHand) {
      throw new Error('Нельзя отгрузить больше, чем зарезервировано/имеется');
    }
    this._reserved -= quantity;
    this._onHand -= quantity;
  }

  public override describe(): string {
    return `${this.sku} в ячейке ${this.location}: ${this.available} своб. / ${this._onHand} всего`;
  }

  private assertPositive(quantity: number): void {
    if (quantity <= 0) throw new Error('Количество должно быть положительным');
  }
}

/** Строка заказа: что и сколько нужно отгрузить. */
interface OrderLine {
  readonly sku: string;
  readonly quantity: number;
}

/**
 * Статусы заказа на складе:
 * NEW — импортирован из магазина; RESERVED — товар зарезервирован;
 * PICKING — идёт сборка; SHIPPED — отгружен; BACKORDER — ждёт поставки.
 */
type OrderStatus = 'NEW' | 'RESERVED' | 'PICKING' | 'SHIPPED' | 'BACKORDER';

/**
 * Заказ из e-commerce. ООП: ИНКАПСУЛЯЦИЯ статуса — меняется только moveTo().
 */
class Order extends Entity {
  private _status: OrderStatus = 'NEW';

  constructor(
    public readonly orderId: string,
    public readonly customer: string,
    public readonly source: string, // канал: "Web", "Маркетплейс"
    public readonly lines: ReadonlyArray<OrderLine>
  ) {
    super(orderId);
  }

  public get status(): OrderStatus {
    return this._status;
  }

  public moveTo(status: OrderStatus): void {
    this._status = status;
  }

  public override describe(): string {
    return `Заказ ${this.orderId} (${this.customer}, ${this.source}): ${this._status}`;
  }
}

/* ====================================================================== *
 * 2. РЕПОЗИТОРИИ                                                         *
 * ====================================================================== */

/**
 * SOLID — DIP: сервисы зависят от этой АБСТРАКЦИИ, а не от конкретного
 * хранилища (память сегодня, БД/REST завтра — сервисы не меняются).
 * SOLID — ISP: интерфейс маленький, только нужные методы.
 * Обобщённый <T extends Entity> — параметрический полиморфизм.
 */
interface IRepository<T extends Entity> {
  getAll(): T[];
  getById(id: string): T | undefined;
  save(entity: T): void;
}

/**
 * SOLID — SRP: единственная ответственность — хранение сущностей в памяти.
 * Обобщённый класс переиспользуется для всех наследников Entity.
 */
class InMemoryRepository<T extends Entity> implements IRepository<T> {
  private readonly store = new Map<string, T>();

  public getAll(): T[] {
    return [...this.store.values()];
  }

  public getById(id: string): T | undefined {
    return this.store.get(id);
  }

  public save(entity: T): void {
    this.store.set(entity.id, entity);
  }
}

/* ====================================================================== *
 * 3. ИНТЕГРАЦИЯ С E-COMMERCE                                             *
 * ====================================================================== */

/**
 * SOLID — OCP + DIP. Абстракция «источник заказов из магазина».
 * Новый канал продаж = новый класс, реализующий интерфейс; код импорта
 * заказов при этом не меняется (закрыт для модификации, открыт для расширения).
 */
interface IEcommerceConnector {
  readonly channel: string;
  fetchNewOrders(): Order[];
}

let orderCounter = 1000;
const nextId = (prefix: string) => `${prefix}-${++orderCounter}`;

/**
 * ПОЛИМОРФИЗМ: обе реализации взаимозаменяемы через интерфейс (LSP).
 * В реальной системе тут были бы HTTP-запросы к API магазина/маркетплейса.
 */
class WebStoreConnector implements IEcommerceConnector {
  public readonly channel = 'Интернет-магазин (Web)';

  public fetchNewOrders(): Order[] {
    return [
      new Order(nextId('WEB'), 'Иванов И.', this.channel, [
        { sku: 'SKU-001', quantity: 2 },
        { sku: 'SKU-003', quantity: 1 }
      ]),
      new Order(nextId('WEB'), 'Петрова А.', this.channel, [
        { sku: 'SKU-002', quantity: 5 }
      ])
    ];
  }
}

class MarketplaceConnector implements IEcommerceConnector {
  public readonly channel = 'Маркетплейс';

  public fetchNewOrders(): Order[] {
    return [
      new Order(nextId('MP'), 'ООО "Ритейл"', this.channel, [
        { sku: 'SKU-003', quantity: 10 }, // больше остатка -> уйдёт в BACKORDER
        { sku: 'SKU-001', quantity: 1 }
      ])
    ];
  }
}

/* ====================================================================== *
 * 4. СЕРВИСЫ (бизнес-логика)                                             *
 * ====================================================================== */

/**
 * SOLID — SRP: только управление остатками (приёмка, резерв, отгрузка по всем
 * ячейкам товара). SOLID — DIP: хранилище приходит через конструктор.
 */
class InventoryService {
  constructor(private readonly inventory: IRepository<InventoryItem>) {}

  /** Все ячейки, где есть данный товар. */
  public itemsForSku(sku: string): InventoryItem[] {
    return this.inventory.getAll().filter((item) => item.sku === sku);
  }

  /** Свободный остаток товара по всему складу. */
  public availableForSku(sku: string): number {
    return this.itemsForSku(sku).reduce((sum, item) => sum + item.available, 0);
  }

  /** Приёмка партии в конкретную ячейку. */
  public receive(sku: string, location: string, quantity: number): void {
    const id = `${sku}@${location}`;
    let item = this.inventory.getById(id);
    if (!item) {
      item = new InventoryItem(sku, location);
      this.inventory.save(item);
    }
    item.receive(quantity);
  }

  /** Зарезервировать товар под заказ (при необходимости из нескольких ячеек). */
  public reserve(sku: string, quantity: number): boolean {
    if (this.availableForSku(sku) < quantity) return false;

    let remaining = quantity;
    for (const item of this.itemsForSku(sku)) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, item.available);
      if (take > 0 && item.reserve(take)) remaining -= take;
    }
    return remaining === 0;
  }

  /** Отгрузить ранее зарезервированный товар. */
  public ship(sku: string, quantity: number): void {
    let remaining = quantity;
    for (const item of this.itemsForSku(sku)) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, item.reserved);
      if (take > 0) {
        item.ship(take);
        remaining -= take;
      }
    }
  }
}

/**
 * SOLID — SRP: только импорт заказов из каналов.
 * SOLID — OCP/DIP: работает со списком абстракций IEcommerceConnector.
 */
class OrderImportService {
  constructor(
    private readonly orders: IRepository<Order>,
    private readonly connectors: ReadonlyArray<IEcommerceConnector>
  ) {}

  public importAll(): Order[] {
    const imported: Order[] = [];
    for (const connector of this.connectors) {
      for (const order of connector.fetchNewOrders()) {
        if (!this.orders.getById(order.id)) {
          this.orders.save(order);
          imported.push(order);
        }
      }
    }
    return imported;
  }
}

/**
 * SOLID — SRP: только выполнение заказа (резерв -> сборка -> отгрузка).
 * SOLID — DIP: зависит от абстракции репозитория и от InventoryService.
 */
class FulfillmentService {
  constructor(
    private readonly orders: IRepository<Order>,
    private readonly inventory: InventoryService
  ) {}

  /** Зарезервировать товар под заказ; при нехватке -> BACKORDER. */
  public reserve(orderId: string): void {
    const order = this.requireOrder(orderId);
    // Резервируем новый заказ или повторно — из BACKORDER (после приёмки).
    if (order.status !== 'NEW' && order.status !== 'BACKORDER') return;

    const canFulfill = order.lines.every(
      (line) => this.inventory.availableForSku(line.sku) >= line.quantity
    );
    if (!canFulfill) {
      order.moveTo('BACKORDER');
      return;
    }

    for (const line of order.lines) this.inventory.reserve(line.sku, line.quantity);
    order.moveTo('RESERVED');
  }

  /** Перевести зарезервированный заказ в сборку. */
  public startPicking(orderId: string): void {
    const order = this.requireOrder(orderId);
    if (order.status === 'RESERVED') order.moveTo('PICKING');
  }

  /** Отгрузить собранный заказ и списать товар со склада. */
  public ship(orderId: string): void {
    const order = this.requireOrder(orderId);
    if (order.status !== 'PICKING') return;
    for (const line of order.lines) this.inventory.ship(line.sku, line.quantity);
    order.moveTo('SHIPPED');
  }

  private requireOrder(orderId: string): Order {
    const order = this.orders.getById(orderId);
    if (!order) throw new Error(`Заказ ${orderId} не найден`);
    return order;
  }
}

/* ====================================================================== *
 * 5. UI (представление, БЭМ)                                            *
 * ====================================================================== */

/** Подписи статусов для отображения. */
const STATUS_LABEL: Record<OrderStatus, string> = {
  NEW: 'Новый',
  RESERVED: 'Зарезервирован',
  PICKING: 'Сборка',
  SHIPPED: 'Отгружен',
  BACKORDER: 'Ожидает поставки'
};

/**
 * SOLID — SRP: класс отвечает ТОЛЬКО за представление (БЭМ-разметка + клики).
 * Бизнес-логики нет — она делегируется сервисам, внедрённым через конструктор (DIP).
 */
class DashboardUI {
  constructor(
    private readonly root: HTMLElement,
    private readonly products: IRepository<Product>,
    private readonly orders: IRepository<Order>,
    private readonly inventory: InventoryService,
    private readonly importService: OrderImportService,
    private readonly fulfillment: FulfillmentService
  ) {}

  public mount(): void {
    this.root.addEventListener('click', (event) => this.handleClick(event));
    this.render();
  }

  private handleClick(event: Event): void {
    const target = event.target as HTMLElement;
    const action = target.dataset['action'];
    if (!action) return;
    const orderId = target.dataset['orderId'];

    switch (action) {
      case 'import':
        this.importService.importAll();
        break;
      case 'reserve':
        if (orderId) this.fulfillment.reserve(orderId);
        break;
      case 'pick':
        if (orderId) this.fulfillment.startPicking(orderId);
        break;
      case 'ship':
        if (orderId) this.fulfillment.ship(orderId);
        break;
    }
    this.render();
  }

  private render(): void {
    this.root.innerHTML = `
      <section class="dashboard">
        ${this.renderStats()}
        <div class="dashboard__columns">
          <div class="dashboard__column">${this.renderInventoryPanel()}</div>
          <div class="dashboard__column">${this.renderOrdersPanel()}</div>
        </div>
      </section>
    `;
  }

  private renderStats(): string {
    const allOrders = this.orders.getAll();
    const shipped = allOrders.filter((o) => o.status === 'SHIPPED').length;
    const backorder = allOrders.filter((o) => o.status === 'BACKORDER').length;
    const onHand = this.products
      .getAll()
      .reduce((sum, p) => sum + this.inventory.availableForSku(p.sku), 0);

    return `
      <div class="stats">
        ${this.stat(String(this.products.getAll().length), 'Позиций в каталоге')}
        ${this.stat(String(onHand), 'Свободно на складе, шт')}
        ${this.stat(String(allOrders.length), 'Заказов всего')}
        ${this.stat(String(shipped), 'Отгружено')}
        ${this.stat(String(backorder), 'Ожидают поставки')}
      </div>
    `;
  }

  private stat(value: string, label: string): string {
    return `
      <div class="stat">
        <span class="stat__value">${value}</span>
        <span class="stat__label">${label}</span>
      </div>
    `;
  }

  private renderInventoryPanel(): string {
    const rows = this.products.getAll().map((p) => this.renderInventoryRow(p)).join('');
    return `
      <article class="panel">
        <header class="panel__header">
          <h2 class="panel__title">Складские остатки</h2>
        </header>
        <div class="panel__body">
          <table class="inventory-table">
            <thead class="inventory-table__head">
              <tr>
                <th class="inventory-table__cell inventory-table__cell--head">Товар</th>
                <th class="inventory-table__cell inventory-table__cell--head">Ячейки</th>
                <th class="inventory-table__cell inventory-table__cell--head">Свободно</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </article>
    `;
  }

  private renderInventoryRow(product: Product): string {
    const items = this.inventory.itemsForSku(product.sku);
    const locations = items.map((i) => i.location).join(', ') || '—';
    const available = this.inventory.availableForSku(product.sku);
    const lowMod = available === 0 ? ' inventory-table__cell--empty' : '';
    return `
      <tr class="inventory-table__row">
        <td class="inventory-table__cell">
          <span class="inventory-table__name">${product.name}</span>
          <span class="inventory-table__sku">${product.sku}</span>
        </td>
        <td class="inventory-table__cell">${locations}</td>
        <td class="inventory-table__cell${lowMod}">${available}</td>
      </tr>
    `;
  }

  private renderOrdersPanel(): string {
    const cards = this.orders.getAll().map((o) => this.renderOrderCard(o)).join('');
    const body =
      cards || `<p class="panel__empty">Заказов пока нет. Нажмите «Импортировать заказы».</p>`;
    return `
      <article class="panel">
        <header class="panel__header">
          <h2 class="panel__title">Заказы из e-commerce</h2>
          <div class="toolbar">
            <button class="toolbar__btn toolbar__btn--primary" data-action="import">
              Импортировать заказы
            </button>
          </div>
        </header>
        <div class="panel__body panel__body--scroll">${body}</div>
      </article>
    `;
  }

  private renderOrderCard(order: Order): string {
    const mod = order.status.toLowerCase();
    const lines = order.lines
      .map((l) => `<li class="order-card__line">${l.sku} × ${l.quantity}</li>`)
      .join('');
    return `
      <div class="order-card order-card--${mod}">
        <div class="order-card__header">
          <span class="order-card__id">${order.orderId}</span>
          <span class="order-card__status order-card__status--${mod}">
            ${STATUS_LABEL[order.status]}
          </span>
        </div>
        <div class="order-card__meta">${order.customer} · ${order.source}</div>
        <ul class="order-card__lines">${lines}</ul>
        <div class="toolbar">${this.renderOrderActions(order)}</div>
      </div>
    `;
  }

  /** ПОЛИМОРФИЗМ по состоянию: кнопки зависят от статуса (конечный автомат). */
  private renderOrderActions(order: Order): string {
    const btn = (action: string, label: string) =>
      `<button class="toolbar__btn" data-action="${action}" data-order-id="${order.orderId}">${label}</button>`;
    switch (order.status) {
      case 'NEW':
      case 'BACKORDER':
        return btn('reserve', 'Зарезервировать');
      case 'RESERVED':
        return btn('pick', 'В сборку');
      case 'PICKING':
        return btn('ship', 'Отгрузить');
      case 'SHIPPED':
        return `<span class="order-card__done">✓ Выполнен</span>`;
    }
  }
}

/* ====================================================================== *
 * 6. COMPOSITION ROOT — сборка приложения                               *
 * ====================================================================== */

/**
 * Единственное место, где создаются конкретные классы и «склеиваются»
 * зависимости. Здесь SOLID — DIP реализуется на практике: сервисы и UI
 * получают абстракции извне, любой компонент легко заменить.
 */

// 1. Хранилища (абстракция IRepository<T>, реализация — InMemory).
const productRepo = new InMemoryRepository<Product>();
const inventoryRepo = new InMemoryRepository<InventoryItem>();
const orderRepo = new InMemoryRepository<Order>();

// 2. Каталог товаров и начальные остатки склада.
[
  new Product('SKU-001', 'Наушники беспроводные', 'Электроника', 4990),
  new Product('SKU-002', 'Кружка керамическая', 'Дом', 590),
  new Product('SKU-003', 'Рюкзак городской', 'Аксессуары', 3200),
  new Product('SKU-004', 'Кабель USB-C', 'Электроника', 350)
].forEach((p) => productRepo.save(p));

const seeding = new InventoryService(inventoryRepo);
seeding.receive('SKU-001', 'A-01-01', 12);
seeding.receive('SKU-002', 'A-02-04', 40);
seeding.receive('SKU-003', 'B-05-02', 3); // мало -> часть заказов уйдёт в BACKORDER
seeding.receive('SKU-004', 'C-01-01', 100);

// 3. Сервисы (зависимости внедряются через конструкторы).
const inventoryService = new InventoryService(inventoryRepo);
const importService = new OrderImportService(orderRepo, [
  new WebStoreConnector(),
  new MarketplaceConnector()
]);
const fulfillmentService = new FulfillmentService(orderRepo, inventoryService);

// 4. UI.
const root = document.getElementById('app');
if (!root) throw new Error('Не найден контейнер #app');

new DashboardUI(
  root,
  productRepo,
  orderRepo,
  inventoryService,
  importService,
  fulfillmentService
).mount();
