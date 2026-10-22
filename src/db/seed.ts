import { pool, withTransaction } from "./pool";

// Kola Gadgets: a made-up Lagos phone and gadget store. All data is fictional.

const naira = (n: number) => n * 100;

const stores = [
  {
    id: "ikeja",
    name: "Kola Gadgets Ikeja",
    address: "14 Allen Avenue, Ikeja, Lagos",
    opening_hours: "Mon to Sat, 9am to 7pm",
  },
  {
    id: "lekki",
    name: "Kola Gadgets Lekki",
    address: "8 Admiralty Way, Lekki Phase 1, Lagos",
    opening_hours: "Mon to Sat, 10am to 8pm; Sun, 12pm to 5pm",
  },
];

// stock: units per store id. Stores left out get a 0 row so every product
// shows at every store.
const products = [
  { id: "IP13-128", name: "iPhone 13", variant: "128GB", price: 650_000, floor: 620_000, stock: { ikeja: 2, lekki: 1 } },
  { id: "IP14-128", name: "iPhone 14", variant: "128GB", price: 820_000, floor: 790_000, stock: { ikeja: 3, lekki: 2 } },
  // One unit in the whole business: the "two buyers, last unit" test.
  { id: "IP15P-256", name: "iPhone 15 Pro", variant: "256GB", price: 1_450_000, floor: 1_400_000, stock: { ikeja: 1 } },
  { id: "S23-256", name: "Samsung Galaxy S23", variant: "256GB", price: 780_000, floor: 750_000, stock: { ikeja: 1, lekki: 2 } },
  { id: "A15-128", name: "Samsung Galaxy A15", variant: "128GB", price: 210_000, floor: 200_000, stock: { ikeja: 6, lekki: 4 } },
  { id: "CAMON20-256", name: "Tecno Camon 20", variant: "256GB", price: 265_000, floor: 250_000, stock: { ikeja: 5, lekki: 3 } },
  { id: "AIRPODS-PRO2", name: "AirPods Pro", variant: "2nd generation", price: 310_000, floor: 295_000, stock: { lekki: 4 } },
  { id: "ANKER-20K", name: "Anker PowerCore power bank", variant: "20,000mAh", price: 45_000, floor: 42_000, stock: { ikeja: 10, lekki: 8 } },
  { id: "APL-20W", name: "Apple USB-C charger", variant: "20W", price: 28_000, floor: 25_000, stock: { ikeja: 12, lekki: 0 } },
];

async function seed() {
  if (process.env.NODE_ENV === "production" && !process.argv.includes("--force")) {
    throw new Error("Seeding wipes all data. Refusing in production without --force.");
  }

  await withTransaction(async (db) => {
    await db.query("TRUNCATE events, orders, stock, products, stores RESTART IDENTITY CASCADE");
    await db.query("ALTER SEQUENCE order_number_seq RESTART WITH 1001");

    for (const s of stores) {
      await db.query(
        "INSERT INTO stores (id, name, address, opening_hours) VALUES ($1, $2, $3, $4)",
        [s.id, s.name, s.address, s.opening_hours],
      );
    }

    for (const p of products) {
      await db.query(
        `INSERT INTO products (id, name, variant, price_kobo, min_price_kobo)
         VALUES ($1, $2, $3, $4, $5)`,
        [p.id, p.name, p.variant, naira(p.price), naira(p.floor)],
      );
      for (const s of stores) {
        const units = (p.stock as Record<string, number>)[s.id] ?? 0;
        await db.query(
          "INSERT INTO stock (product_id, store_id, available) VALUES ($1, $2, $3)",
          [p.id, s.id, units],
        );
      }
    }

    await db.query("INSERT INTO events (type, detail) VALUES ('seeded', $1)", [
      { stores: stores.length, products: products.length },
    ]);
  });

  console.log(`Seeded Kola Gadgets: ${stores.length} stores, ${products.length} products`);
}

seed()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
