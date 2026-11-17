import { z } from "zod";
export const BUSINESS_CATEGORIES = [
  "all","restaurant","cafe","shop","supermarket","clothing","electronics","grocery",
  "clinic","hospital","pharmacy","dentist","school","college","university",
  "hotel","guest_house","salon","beauty","gym","bank","real_estate","car_repair",
  "lawyer","accountant","office","tourism","fuel"
] as const;
export const SearchRequestSchema = z.object({
  category:z.enum(BUSINESS_CATEGORIES),
  city:z.string().trim().min(2).max(80),
  locality:z.string().trim().max(100).optional().default(""),
  bbox:z.object({
    south:z.number().min(-90).max(90),west:z.number().min(-180).max(180),
    north:z.number().min(-90).max(90),east:z.number().min(-180).max(180)
  }).refine(b=>b.south<b.north && b.west<b.east,"South/west must be less than north/east."),
  maxResults:z.number().int().min(1).max(100)
});
export type SearchRequest = z.infer<typeof SearchRequestSchema>;
