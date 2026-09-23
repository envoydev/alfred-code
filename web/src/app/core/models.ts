export interface Paged<T> {
  items: T[];
  page: number;
  pageSize: number;
  totalCount: number;
}

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  code?: string;
  traceId?: string;
  errors?: Record<string, string[]>;
}

export type MemberStatus = 'Active' | 'Suspended';

export interface Member {
  id: number;
  name: string;
  email: string;
  status: MemberStatus;
  createdAt: string;
}

export interface MemberInput {
  name: string;
  email: string;
}

export type ItemCondition = 'Good' | 'Worn' | 'Damaged';

export interface Item {
  id: number;
  name: string;
  category: string;
  sku: string;
  totalStock: number;
  available: number;
  condition: ItemCondition;
  isRetired: boolean;
}

export interface ItemInput {
  name: string;
  category: string;
  sku: string;
  totalStock: number;
  condition: ItemCondition;
}

export type LoanStatus = 'Active' | 'Returned' | 'Overdue';

export interface Loan {
  id: number;
  itemId: number;
  itemName: string;
  memberId: number;
  memberName: string;
  startDate: string;
  dueDate: string;
  returnedAt: string | null;
  status: LoanStatus;
}

export interface LoanInput {
  itemId: number;
  memberId: number;
  startDate: string;
  dueDate: string;
}

export interface OverdueLoan {
  loanId: number;
  itemName: string;
  memberName: string;
  dueDate: string;
  daysOverdue: number;
}
