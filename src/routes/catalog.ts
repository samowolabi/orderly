import { Router } from "express";
import * as controller from "../controllers/catalog";
import { requireRole } from "../middleware/auth";

export const catalog = Router();

catalog.get("/stores", requireRole("buyer", "seller"), controller.listStores);
catalog.post("/stores", requireRole("seller"), controller.addStore);
catalog.patch("/stores/:id", requireRole("seller"), controller.updateStore);

catalog.get("/products", requireRole("buyer", "seller"), controller.listProducts);
catalog.post("/products", requireRole("seller"), controller.addProduct);
catalog.post("/products/:id/stock", requireRole("seller"), controller.updateStock);
catalog.patch("/products/:id", requireRole("seller"), controller.updatePrice);
