import { Router } from "express";
import * as controller from "../controllers/catalog";
import { requireRole } from "../middleware/auth";

export const catalog = Router();

catalog.get("/stores", requireRole("buyer", "seller"), controller.listStores);
catalog.post("/stores", requireRole("seller"), controller.addStore);
catalog.patch("/stores/:id", requireRole("seller"), controller.updateStore);

catalog.get("/products", requireRole("buyer", "seller"), controller.listProducts);
// The owner's view of the same data, as separate tools: in Chord a shared tool carries one
// key (the buyer key), so the owner needs tools of their own that carry the seller key.
catalog.get("/owner/stores", requireRole("seller"), controller.listStores);
catalog.get("/owner/products", requireRole("seller"), controller.listProducts);
catalog.post("/products", requireRole("seller"), controller.addProduct);
catalog.patch("/products/:id", requireRole("seller"), controller.updateProduct);
