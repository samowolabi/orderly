import type { Request, Response } from "express";
import {
  AddProductBody,
  AddStoreBody,
  ListProductsQuery,
  ProductParams,
  StoreParams,
  UpdateProductBody,
  UpdateStoreBody,
} from "../openapi/schemas/catalog";
import * as catalogService from "../services/catalog";
import { parse, success } from "../utils/http";

// Returns all stores through the catalog service.
export async function listStores(_request: Request, response: Response) {
  success(response, await catalogService.listStores());
}

// Validates and creates a new store.
export async function addStore(request: Request, response: Response) {
  const input = parse(AddStoreBody, request.body);
  success(response, await catalogService.addStore(input), 201);
}

// Validates and applies a partial store update.
export async function updateStore(request: Request, response: Response) {
  const { id } = parse(StoreParams, request.params);
  const input = parse(UpdateStoreBody, request.body);
  success(response, await catalogService.updateStore(id, input));
}

// Returns products filtered for the caller's role and query.
export async function listProducts(request: Request, response: Response) {
  const filters = parse(ListProductsQuery, request.query);
  success(response, await catalogService.listProducts(filters, response.locals.role));
}

// Validates and creates one or more products with starting stock.
export async function addProduct(request: Request, response: Response) {
  const input = parse(AddProductBody, request.body);
  success(response, await catalogService.addProducts(input.products), 201);
}

// Validates and applies any mix of product, price, sale status and stock changes.
export async function updateProduct(request: Request, response: Response) {
  const { id } = parse(ProductParams, request.params);
  const input = parse(UpdateProductBody, request.body);
  success(response, await catalogService.updateProduct(id, input));
}
