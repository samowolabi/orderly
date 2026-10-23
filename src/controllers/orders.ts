import type { Request, Response } from "express";
import { ContactOwnerBody, CreateOrderBody, DeliverySettingsBody, ListOrdersQuery, OrderParams, QuoteDeliveryBody } from "../openapi/schemas/orders";
import * as contactService from "../services/contact";
import * as deliveryService from "../services/delivery";
import * as orderService from "../services/orders";
import { parse, success } from "../utils/http";

// Validates a delivery request and returns a stored quote from the nearest store.
export async function quoteDelivery(request: Request, response: Response) {
  const input = parse(QuoteDeliveryBody, request.body);
  success(response, await deliveryService.quoteDelivery(input), 201);
}

// Reads or changes the owner's delivery pricing.
export async function deliverySettings(request: Request, response: Response) {
  const input = parse(DeliverySettingsBody, request.body ?? {});
  success(response, await deliveryService.deliverySettings(input));
}

// Validates an order request and returns its payment link.
export async function createOrder(request: Request, response: Response) {
  const input = parse(CreateOrderBody, request.body);
  success(response, await orderService.createOrder(input), 201);
}

// Verifies an order payment and returns its current outcome.
export async function verifyPayment(request: Request, response: Response) {
  const { id } = parse(OrderParams, request.params);
  success(response, await orderService.verifyPayment(id));
}

// Returns the receipt for a confirmed order.
export async function getReceipt(request: Request, response: Response) {
  const { id } = parse(OrderParams, request.params);
  success(response, await orderService.getReceipt(id));
}

// Validates owner filters and returns matching orders.
export async function listOrders(request: Request, response: Response) {
  const input = parse(ListOrdersQuery, request.query);
  success(response, await orderService.listOrders(input));
}

// Emails the owner a customer's request to talk to a person.
export async function contactOwner(request: Request, response: Response) {
  const input = parse(ContactOwnerBody, request.body);
  success(response, await contactService.contactOwner(input));
}
