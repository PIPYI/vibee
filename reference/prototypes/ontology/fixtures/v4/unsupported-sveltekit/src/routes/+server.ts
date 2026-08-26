import { json } from "@sveltejs/kit";
import { billingClient } from "$lib/server/billing";

export async function POST({ request }) {
  const order = await request.json();
  const payment = await billingClient.pay(order.total);
  return json({ paymentId: payment.id });
}
