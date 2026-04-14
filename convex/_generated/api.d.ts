/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as actionStore from "../actionStore.js";
import type * as admin from "../admin.js";
import type * as reviewGap from "../reviewGap.js";
import type * as reviewGapActions from "../reviewGapActions.js";
import type * as reviewGapClient from "../reviewGapClient.js";
import type * as reviewGapInternal from "../reviewGapInternal.js";
import type * as reviewGapPublic from "../reviewGapPublic.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  actionStore: typeof actionStore;
  admin: typeof admin;
  reviewGap: typeof reviewGap;
  reviewGapActions: typeof reviewGapActions;
  reviewGapClient: typeof reviewGapClient;
  reviewGapInternal: typeof reviewGapInternal;
  reviewGapPublic: typeof reviewGapPublic;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
