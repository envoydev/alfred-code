export const ORDER_STATUSES = ['Pending', 'Shipped', 'Delivered'] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** A status to show, or every order. */
export type StatusFilter = OrderStatus | 'All';

export interface Order {
  id: number;
  customer: string;
  status: OrderStatus;
  /** The order total in US dollars. */
  total: number;
  /** ISO 8601 timestamp. */
  placedAt: string;
}
