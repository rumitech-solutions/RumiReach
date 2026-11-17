# Pilot Area Definition

## Pilot target
- Category: Restaurants
- City: Karachi, Sindh, Pakistan
- Locality: Gulshan-e-Iqbal
- Target: 50 unique candidates (measurement target only)

## Boundary must be explicit
"Gulshan-e-Iqbal" can refer to the neighbourhood, historic town, or a subset of numbered blocks. These are not necessarily the same boundary. The first query must use an operator-reviewed bounding box or boundary polygon. Do not infer the search boundary from a single place-name coordinate.

The dashboard currently asks for decimal-degree coordinates:
- South latitude
- West longitude
- North latitude
- East longitude

Coordinate order for the API is south, west, north, east (WGS84).

## How to provide the boundary
The operator can provide:
1. A bounding box copied from a map/GIS tool, or
2. A clear scope such as specific blocks/sectors, after which a boundary will be reviewed and recorded here.

A bounding box may include neighbouring areas. Review the resulting candidate list and retain locality labels/source tags where available.

## Source caveat
The first source is OpenStreetMap. The number of restaurants and the phone/website field coverage depend on community mapping. If fewer than 50 records are present, report actual coverage; do not silently add records from prohibited scraping sources.
