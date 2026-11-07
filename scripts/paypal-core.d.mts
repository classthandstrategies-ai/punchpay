export const BASE: string;
export type Money = { currency_code: string; value: string };
export type PayPalLink = { href: string; rel: string; method?: string };
export type PayPalAuthorization = { id: string; status: string; amount?: Money; expiration_time?: string; payee?: { merchant_id?: string; email_address?: string }; supplementary_data?: { related_ids?: { order_id?: string } }; payeeVerifiedVia?: "authorization" | "parent_order" };
export type PayPalCapture = { id: string; status: string; amount?: Money };
export type PayPalOrder = {
  id: string;
  status: string;
  links?: PayPalLink[];
  purchase_units?: {
    reference_id?: string;
    amount?: Money;
    payee?: { merchant_id?: string; email_address?: string };
    payments?: { authorizations?: PayPalAuthorization[]; captures?: PayPalCapture[] };
  }[];
};
export function amount(cents: number): string;
export function assertPayee(resource: unknown, expectedMerchantId: string | undefined): string;
export function assertAmount(money: Money | undefined, cents: number, label?: string): void;
export function assertOrderMatches(order: PayPalOrder, expect: { referenceId?: string; cents: number; merchantId: string }): string;
export function getAuth(order: PayPalOrder): PayPalAuthorization;
export function getCaptureFromOrder(order: PayPalOrder): PayPalCapture | null;
export function approvalUrl(order: PayPalOrder): string | null;
export class PayPalError extends Error { status?: number; issue?: string; debugId?: string }
export class PayPalSandbox {
  constructor(opts: { clientId?: string; secret?: string; merchantId?: string; fetchImpl?: typeof fetch });
  merchantId: string;
  request<T = unknown>(path: string, opts?: { method?: "GET" | "POST"; body?: object; requestId?: string }): Promise<T>;
  getOrder(orderId: string): Promise<PayPalOrder>;
  getAuthorization(authId: string): Promise<PayPalAuthorization>;
  getCapture(captureId: string): Promise<PayPalCapture>;
  createOrder(opts: { referenceId: string; description: string; cents: number; requestId: string; returnUrl?: string; cancelUrl?: string }): Promise<{ order: PayPalOrder; payee: string }>;
  authorizeApproved(orderId: string, opts: { referenceId: string; cents: number; requestId: string }): Promise<{ authorization: PayPalAuthorization; recovered: boolean; payee: string }>;
  verifiedAuthorization(authId: string, cents: number, orderId?: string | null): Promise<PayPalAuthorization>;
  captureAuthorization(authId: string, opts: { cents: number; requestId: string; orderId?: string | null }): Promise<{ captureId: string; status: string }>;
  voidAuthorization(authId: string, opts: { cents: number; requestId: string; orderId?: string | null }): Promise<{ authorizationId: string; status: string }>;
}
