import { beforeEach, describe, expect, it, vi } from "vitest";
import { ACTIVE_STORE_SLUG } from "@/config/store.config";
import type { Product } from "@/data/catalog";

interface RecordedQuery {
  table: string;
  op: "select" | "insert" | "upsert" | "update" | "delete" | null;
  payload?: unknown;
  options?: unknown;
  eqs: Array<[string, unknown]>;
  ins: Array<[string, unknown[]]>;
}

const {
  recordedQueries,
  setMockSingleResult,
  storageUploadMock,
  storageRemoveMock,
  authGetSessionMock,
  authGetUserMock,
  authSignInWithPasswordMock,
  authSignOutMock,
  mockSupabaseClient,
} = vi.hoisted(() => {
  const queries: RecordedQuery[] = [];
  let singleResult: { data: unknown; error: null } = { data: null, error: null };

  function createChain(table: string) {
    const entry: RecordedQuery = { table, op: null, eqs: [], ins: [] };
    queries.push(entry);

    const chain: Record<string, unknown> = {
      select: vi.fn((_cols?: string, _opts?: unknown) => {
        if (!entry.op) entry.op = "select";
        return chain;
      }),
      insert: vi.fn((payload: unknown) => {
        entry.op = "insert";
        entry.payload = payload;
        return chain;
      }),
      upsert: vi.fn((payload: unknown, options?: unknown) => {
        entry.op = "upsert";
        entry.payload = payload;
        entry.options = options;
        return chain;
      }),
      update: vi.fn((payload: unknown) => {
        entry.op = "update";
        entry.payload = payload;
        return chain;
      }),
      delete: vi.fn(() => {
        entry.op = "delete";
        return chain;
      }),
      eq: vi.fn((col: string, val: unknown) => {
        entry.eqs.push([col, val]);
        return chain;
      }),
      in: vi.fn((col: string, vals: unknown[]) => {
        entry.ins.push([col, vals]);
        return chain;
      }),
      order: vi.fn(() => chain),
      maybeSingle: vi.fn(async () => ({ data: null, error: null })),
      single: vi.fn(async () => ({
        data: singleResult.data,
        error: singleResult.error,
      })),
      then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve({ data: [], error: null }).then(resolve, reject),
    };
    return chain;
  }

  const storageUpload = vi.fn(async () => ({ data: { path: "" }, error: null }));
  const storageRemove = vi.fn(async () => ({ data: [], error: null }));
  const storageGetPublicUrl = vi.fn((path: string) => ({
    data: {
      publicUrl: `https://central.supabase.co/storage/v1/object/public/store-media/${path}`,
    },
  }));

  const authGetSession = vi.fn();
  const authGetUser = vi.fn();
  const authSignInWithPassword = vi.fn();
  const authSignOut = vi.fn(async () => ({ error: null }));
  const authOnAuthStateChange = vi.fn();

  const client = {
    from: vi.fn((table: string) => createChain(table)),
    storage: {
      from: vi.fn(() => ({
        upload: storageUpload,
        remove: storageRemove,
        getPublicUrl: storageGetPublicUrl,
      })),
    },
    auth: {
      getSession: authGetSession,
      getUser: authGetUser,
      signInWithPassword: authSignInWithPassword,
      signOut: authSignOut,
      onAuthStateChange: authOnAuthStateChange,
    },
  };

  return {
    recordedQueries: queries,
    setMockSingleResult: (next: { data: unknown; error: null }) => {
      singleResult = next;
    },
    storageUploadMock: storageUpload,
    storageRemoveMock: storageRemove,
    authGetSessionMock: authGetSession,
    authGetUserMock: authGetUser,
    authSignInWithPasswordMock: authSignInWithPassword,
    authSignOutMock: authSignOut,
    mockSupabaseClient: client,
  };
});

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return {
    ...actual,
    isSupabaseConfigured: true,
    supabase: mockSupabaseClient,
    requireSupabase: () => mockSupabaseClient,
  };
});

import { toProductPayload } from "@/lib/supabase";
import { WRONG_STORE_ACCOUNT_ERROR, isUserAuthorizedForStore } from "@/lib/tenant-auth";
import { getAuthState, signInAdmin } from "@/services/authService";
import {
  addCatalogOption,
  deleteCatalogOption,
  listCatalogOptions,
  seedCatalogOptionsForNiche,
} from "@/services/catalogOptionsService";
import {
  buildStoreMediaPath,
  deleteStoreImage,
  deleteStoreImages,
  isStoreMediaPathOwned,
  uploadOriginalBannerImage,
} from "@/services/storageService";
import {
  bulkRemoveProductsInDb,
  bulkUpdateProductsInDb,
  fetchStoreData,
  removeBanner,
  removeCoupon,
  removeProduct,
  saveStoreAnnouncement,
  saveStorePromotion,
} from "@/services/storeService";

describe("Multi-tenant store_slug isolation", () => {
  beforeEach(() => {
    recordedQueries.length = 0;
    setMockSingleResult({ data: null, error: null });
    vi.clearAllMocks();
    authGetUserMock.mockResolvedValue({
      data: { user: { id: "admin-1", email: "admin@loja.com" } },
      error: null,
    });
  });

  it("includes ACTIVE_STORE_SLUG in toProductPayload", () => {
    const sample: Product = {
      id: "prod-1",
      name: "Vestido Linho",
      sku: "VL01",
      category: "Vestidos",
      material: "Linho",
      price: 159.9,
      sale_price: 0,
      is_on_sale: false,
      sale_label: "",
      image_url: "",
      description: "Leve e elegante",
      active: true,
      featured: false,
      in_stock: true,
      characteristics: [],
      sizes: ["P", "M"],
    };

    const payload = toProductPayload(sample);
    expect(payload.store_slug).toBe(ACTIVE_STORE_SLUG);
  });

  it("evaluates isUserAuthorizedForStore rules accurately", () => {
    expect(isUserAuthorizedForStore({ store_slug: "patricia-modas" }, "patricia-modas")).toBe(true);
    expect(isUserAuthorizedForStore({ store_slug: " PATRICIA-MODAS " }, "patricia-modas")).toBe(
      true,
    );
    expect(isUserAuthorizedForStore({ store_slug: "outra-loja" }, "patricia-modas")).toBe(false);
    expect(isUserAuthorizedForStore({ store_slug: "*" }, "patricia-modas")).toBe(true);
    expect(
      isUserAuthorizedForStore({ store_slug: "outra-loja", role: "superadmin" }, "patricia-modas"),
    ).toBe(true);
    expect(
      isUserAuthorizedForStore({ store_slug: "outra-loja", role: "super_admin" }, "patricia-modas"),
    ).toBe(true);
    expect(
      isUserAuthorizedForStore(
        { store_slug: "outra-loja", is_super_admin: true },
        "patricia-modas",
      ),
    ).toBe(true);
    expect(
      isUserAuthorizedForStore(
        { store_slug: "outra-loja", is_super_admin: false },
        "patricia-modas",
      ),
    ).toBe(false);
    expect(isUserAuthorizedForStore({}, "patricia-modas")).toBe(true);
    expect(isUserAuthorizedForStore(undefined, "patricia-modas")).toBe(true);
  });

  it("blocks login and signs out when user_metadata.store_slug belongs to another store", async () => {
    authSignInWithPasswordMock.mockResolvedValueOnce({
      data: {
        user: {
          id: "u-other",
          email: "dona@outraloja.com",
          user_metadata: { store_slug: "outra-loja-diferente" },
        },
      },
      error: null,
    });

    await expect(signInAdmin("dona@outraloja.com", "secret")).rejects.toThrow(
      WRONG_STORE_ACCOUNT_ERROR,
    );
    expect(authSignOutMock).toHaveBeenCalledTimes(1);
  });

  it("allows login for matching store_slug, wildcard '*', and super admin accounts", async () => {
    for (const metadata of [
      { store_slug: ACTIVE_STORE_SLUG },
      { store_slug: "*" },
      { store_slug: "outra-loja", role: "superadmin" },
      { store_slug: "outra-loja", role: "super_admin" },
      { store_slug: "outra-loja", is_super_admin: true },
    ]) {
      authSignInWithPasswordMock.mockResolvedValueOnce({
        data: {
          user: {
            id: "u-ok",
            email: "admin@loja.com",
            user_metadata: metadata,
          },
        },
        error: null,
      });

      const state = await signInAdmin("admin@loja.com", "secret");
      expect(state.authenticated).toBe(true);
    }
    expect(authSignOutMock).not.toHaveBeenCalled();
  });

  it("allows persisted Super Admin session in getAuthState regardless of store_slug", async () => {
    for (const metadata of [
      { store_slug: "loja-estrangeira", is_super_admin: true },
      { store_slug: "loja-estrangeira", role: "super_admin" },
    ]) {
      authGetSessionMock.mockResolvedValueOnce({
        data: {
          session: {
            user: {
              id: "u-super",
              email: "super@admin.com",
              user_metadata: metadata,
            },
          },
        },
        error: null,
      });

      const state = await getAuthState();
      expect(state.authenticated).toBe(true);
      expect(state.unauthorizedStore).toBeUndefined();
    }
    expect(authSignOutMock).not.toHaveBeenCalled();
  });

  it("signs out unauthorized persisted session in getAuthState", async () => {
    authGetSessionMock.mockResolvedValueOnce({
      data: {
        session: {
          user: {
            id: "u-wrong",
            email: "wrong@loja.com",
            user_metadata: { store_slug: "loja-estrangeira" },
          },
        },
      },
      error: null,
    });

    const state = await getAuthState();
    expect(state.authenticated).toBe(false);
    expect(state.unauthorizedStore).toBe(true);
    expect(authSignOutMock).toHaveBeenCalledTimes(1);
  });

  it("prefixes Storage uploads with ACTIVE_STORE_SLUG and prevents cross-tenant deletions", async () => {
    expect(buildStoreMediaPath("products", "item.webp")).toBe(
      `${ACTIVE_STORE_SLUG}/products/item.webp`,
    );
    expect(isStoreMediaPathOwned(`${ACTIVE_STORE_SLUG}/products/item.webp`)).toBe(true);
    expect(isStoreMediaPathOwned("products/legacy.webp")).toBe(true);
    expect(isStoreMediaPathOwned("outra-loja/products/item.webp")).toBe(false);

    const file = new File([new Uint8Array([1, 2, 3])], "banner.png", { type: "image/png" });
    const uploaded = await uploadOriginalBannerImage(file);
    expect(storageUploadMock).toHaveBeenCalledTimes(1);
    const uploadedPath = (storageUploadMock.mock.calls[0] as unknown[] | undefined)?.[0];
    expect(typeof uploadedPath).toBe("string");
    expect(String(uploadedPath)).toMatch(new RegExp(`^${ACTIVE_STORE_SLUG}/banners/.+\\.png$`));
    expect(uploaded.url).toContain(`/${ACTIVE_STORE_SLUG}/banners/`);

    // Cross-tenant image URL must be ignored
    await deleteStoreImage(
      "https://central.supabase.co/storage/v1/object/public/store-media/outra-loja/products/p1.webp",
    );
    expect(storageRemoveMock).not.toHaveBeenCalled();

    // Mixed batch delete only removes paths owned by active store
    await deleteStoreImages([
      `https://central.supabase.co/storage/v1/object/public/store-media/${ACTIVE_STORE_SLUG}/products/mine.webp`,
      "https://central.supabase.co/storage/v1/object/public/store-media/outra-loja/products/other.webp",
    ]);
    expect(storageRemoveMock).toHaveBeenCalledWith([`${ACTIVE_STORE_SLUG}/products/mine.webp`]);
  });

  it("scopes fetchStoreData, settings upserts, deletes, and bulk actions by store_slug", async () => {
    await fetchStoreData("admin");

    const queriedTables = ["products", "hero_banners", "coupons", "store_settings", "admin_profiles"];
    for (const table of queriedTables) {
      const q = recordedQueries.find((item) => item.table === table && item.op === "select");
      expect(q, `Expected select query on ${table}`).toBeDefined();
      expect(q?.eqs).toContainEqual(["store_slug", ACTIVE_STORE_SLUG]);
    }

    // store_settings upserts must use onConflict: "store_slug" without fixed id: 1
    recordedQueries.length = 0;
    setMockSingleResult({
      data: {
        id: "uuid-settings",
        store_slug: ACTIVE_STORE_SLUG,
        announcement_active: true,
        announcement_text: "Frete grátis",
        announcement_link: "#vitrine",
        promo_active: true,
        promo_badge: "VIP",
        promo_title: "Promo",
        promo_description: "Desc",
        promo_highlight: "20%",
        promo_cta_label: "Ver",
        promo_cta_type: "vitrine",
      },
      error: null,
    });

    await saveStoreAnnouncement({ active: true, text: "Frete grátis", link: "#vitrine" });
    await saveStorePromotion({
      promo_active: true,
      promo_badge: "VIP",
      promo_title: "Promo",
      promo_description: "Desc",
      promo_highlight: "20%",
      promo_cta_label: "Ver",
      promo_cta_type: "vitrine",
    });

    const settingsUpserts = recordedQueries.filter(
      (q) => q.table === "store_settings" && q.op === "upsert",
    );
    expect(settingsUpserts).toHaveLength(2);
    for (const u of settingsUpserts) {
      expect(u.options).toEqual({ onConflict: "store_slug" });
      expect((u.payload as Record<string, unknown>)["store_slug"]).toBe(ACTIVE_STORE_SLUG);
      expect((u.payload as Record<string, unknown>)["id"]).toBeUndefined();
    }

    // Individual & bulk updates/deletes must include .eq("store_slug", ACTIVE_STORE_SLUG)
    recordedQueries.length = 0;
    await removeProduct("p1");
    await bulkUpdateProductsInDb(["p1", "p2"], { in_stock: false });
    await bulkRemoveProductsInDb(["p1", "p2"]);
    await removeBanner("b1");
    await removeCoupon("c1");

    expect(recordedQueries).toHaveLength(5);
    for (const q of recordedQueries) {
      expect(q.eqs).toContainEqual(["store_slug", ACTIVE_STORE_SLUG]);
    }
  });

  it("scopes catalog_options queries, seeds, inserts, and deletes by store_slug", async () => {
    await listCatalogOptions();
    expect(recordedQueries[0]?.table).toBe("catalog_options");
    expect(recordedQueries[0]?.eqs).toContainEqual(["store_slug", ACTIVE_STORE_SLUG]);

    recordedQueries.length = 0;
    await seedCatalogOptionsForNiche("moda");
    const seedQuery = recordedQueries.find((q) => q.op === "insert");
    const seedRows = seedQuery?.payload as Array<Record<string, unknown>>;
    expect(seedRows.length).toBeGreaterThan(0);
    expect(seedRows.every((row) => row["store_slug"] === ACTIVE_STORE_SLUG)).toBe(true);

    recordedQueries.length = 0;
    setMockSingleResult({
      data: {
        id: "opt-1",
        type: "category",
        name: "Jaquetas",
        created_at: new Date().toISOString(),
      },
      error: null,
    });
    await addCatalogOption("category", "Jaquetas");
    const insertOpt = recordedQueries.find((q) => q.op === "insert");
    expect(insertOpt?.payload).toEqual({
      store_slug: ACTIVE_STORE_SLUG,
      type: "category",
      name: "Jaquetas",
    });

    recordedQueries.length = 0;
    await deleteCatalogOption("opt-1");
    expect(recordedQueries[0]?.op).toBe("delete");
    expect(recordedQueries[0]?.eqs).toContainEqual(["store_slug", ACTIVE_STORE_SLUG]);
  });
});
