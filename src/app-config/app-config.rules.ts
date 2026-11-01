import { APP_STORE_LISTING_URL } from "./app-config.constants";

export function isOwnStoreListing(platform: keyof typeof APP_STORE_LISTING_URL, updateUrl: string): boolean {
  return updateUrl === APP_STORE_LISTING_URL[platform];
}
