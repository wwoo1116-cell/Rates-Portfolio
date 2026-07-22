"""
Loaders layer: file I/O for market data (no QL computation, no HTTP).

Depends on core/ only. All other layers (services, api) may import from here;
this layer never imports from engine, services, or api.
"""
