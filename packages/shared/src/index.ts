import { z } from "zod";
export const SearchRequestSchema = z.object({
  category:z.literal("restaurant"),
  city:z.string().trim().min(2).max(80),
  locality:z.string().trim().min(2).max(100),
  bbox:z.object({
    south:z.number().min(-90).max(90),west:z.number().min(-180).max(180),
    north:z.number().min(-90).max(90),east:z.number().min(-180).max(180)
  }).refine(b=>b.south<b.north && b.west<b.east,"South/west must be less than north/east."),
  maxResults:z.number().int().min(1).max(100)
});
export type SearchRequest = z.infer<typeof SearchRequestSchema>;
