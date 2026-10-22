import type { Request, Response } from "express";
import { ok } from "../http/respond";
import { parse } from "../http/validate";
import { CreateOrderBody, ListOrdersQuery, OrderParams } from "../openapi/schemas/orders";
import * as orderService from "../services/orders";

export async function createOrder(request: Request, response: Response) {
  const input = parse(CreateOrderBody, request.body);
  ok(response, await orderService.createOrder(input), 201);
}

export async function verifyPayment(request: Request, response: Response) {
  const { id } = parse(OrderParams, request.params);
  ok(response, await orderService.verifyPayment(id));
}

export async function getReceipt(request: Request, response: Response) {
  const { id } = parse(OrderParams, request.params);
  ok(response, await orderService.getReceipt(id));
}

export async function listOrders(request: Request, response: Response) {
  const input = parse(ListOrdersQuery, request.query);
  ok(response, await orderService.listOrders(input));
}
