export type OrderStatus = 'Pending' | 'Shipped' | 'Delivered';

export interface Order {
  id: number;
  customer: string;
  status: OrderStatus;
  /** The order total in US dollars. */
  total: number;
  /** ISO 8601 timestamp. */
  placedAt: string;
}

/** The server's answer to an accepted discount code: the order's new total in US dollars. */
export interface DiscountResult {
  total: number;
}
