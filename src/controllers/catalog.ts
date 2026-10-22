import type { Request, Response } from "express";
import {
  AddProductBody,
  AddStoreBody,
  ListProductsQuery,
  ProductParams,
  StoreParams,
  UpdatePriceBody,
  UpdateStockBody,
  UpdateStoreBody,
} from "../openapi/schemas/catalog";
import * as catalogService from "../services/catalog";
import { ok, parse } from "../utils/http";

// Returns all stores through the catalog service.
export async function listStores(_request: Request, response: Response) {
  ok(response, await catalogService.listStores());
}

// Validates and creates a new store.
export async function addStore(request: Request, response: Response) {
  const input = parse(AddStoreBody, request.body);
  ok(response, await catalogService.addStore(input), 201);
}

// Validates and applies a partial store update.
export async function updateStore(request: Request, response: Response) {
  const { id } = parse(StoreParams, request.params);
  const input = parse(UpdateStoreBody, request.body);
  ok(response, await catalogService.updateStore(id, input));
}

// Returns products filtered for the caller's role and query.
export async function listProducts(request: Request, response: Response) {
  const filters = parse(ListProductsQuery, request.query);
  ok(response, await catalogService.listProducts(filters, response.locals.role));
}

// Validates and creates a product with starting stock.
export async function addProduct(request: Request, response: Response) {
  const input = parse(AddProductBody, request.body);
  ok(response, await catalogService.addProduct(input), 201);
}

// Validates and applies a stock adjustment for one store.
export async function updateStock(request: Request, response: Response) {
  const { id } = parse(ProductParams, request.params);
  const input = parse(UpdateStockBody, request.body);
  ok(response, await catalogService.updateStock(id, input));
}

// Validates and applies a product price change.
export async function updatePrice(request: Request, response: Response) {
  const { id } = parse(ProductParams, request.params);
  const input = parse(UpdatePriceBody, request.body);
  ok(response, await catalogService.updatePrice(id, input));
}
