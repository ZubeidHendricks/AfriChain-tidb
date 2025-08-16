/**
 * Product Catalog Component
 * 
 * Public product catalog interface with search and filtering capabilities.
 * Integrates with the backend catalog API endpoints.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Card,
  CardContent,
  CardMedia,
  Grid,
  Typography,
  TextField,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Pagination,
  Chip,
  Button,
  Paper,
  InputAdornment,
  Skeleton,
  Alert,
  Divider,
  Container,
} from '@mui/material';
import {
  Search as SearchIcon,
  FilterList as FilterIcon,
  Clear as ClearIcon,
  LocationOn as LocationIcon,
  Category as CategoryIcon,
  Business as BusinessIcon,
} from '@mui/icons-material';
import { useQuery } from '@tanstack/react-query';

// Types for the catalog data
interface CatalogProduct {
  id: string;
  productName: string;
  description: string;
  category: string;
  brand?: string;
  manufacturerName?: string;
  originCountry?: string;
  primaryImage?: {
    url: string;
    thumbnailUrl: string;
  };
  totalImages: number;
  createdAt: string;
}

interface CatalogResponse {
  success: boolean;
  data: {
    products: CatalogProduct[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
      hasNext: boolean;
      hasPrev: boolean;
    };
    filters: {
      query?: string;
      category?: string;
      location?: string;
      applied: {
        hasQuery: boolean;
        hasCategory: boolean;
        hasLocation: boolean;
      };
    };
  };
}

interface FilterOptions {
  categories: string[];
  locations: string[];
  availableFilters: {
    categories: string[];
    countries: string[];
    totalProducts: number;
  };
}

interface FilterOptionsResponse {
  success: boolean;
  data: FilterOptions;
}

// API service for catalog requests
const catalogApi = {
  async getProducts(params: {
    page?: number;
    limit?: number;
    q?: string;
    category?: string;
    location?: string;
  }): Promise<CatalogResponse> {
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== '') {
        searchParams.append(key, value.toString());
      }
    });
    
    const response = await fetch(`/api/products/catalog?${searchParams}`);
    if (!response.ok) {
      throw new Error('Failed to fetch products');
    }
    return response.json();
  },

  async getFilterOptions(): Promise<FilterOptionsResponse> {
    const response = await fetch('/api/products/catalog/filters');
    if (!response.ok) {
      throw new Error('Failed to fetch filter options');
    }
    return response.json();
  },
};

export const ProductCatalog: React.FC = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [selectedLocation, setSelectedLocation] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
      setCurrentPage(1); // Reset to first page on search
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Fetch filter options
  const {
    data: filterOptions,
    isLoading: filtersLoading,
    error: filtersError
  } = useQuery({
    queryKey: ['catalog-filters'],
    queryFn: catalogApi.getFilterOptions,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  // Fetch products
  const {
    data: catalogData,
    isLoading: productsLoading,
    error: productsError,
    refetch: refetchProducts
  } = useQuery({
    queryKey: ['catalog-products', {
      page: currentPage,
      q: debouncedSearchQuery,
      category: selectedCategory,
      location: selectedLocation,
    }],
    queryFn: () => catalogApi.getProducts({
      page: currentPage,
      limit: 12,
      q: debouncedSearchQuery || undefined,
      category: selectedCategory || undefined,
      location: selectedLocation || undefined,
    }),
    keepPreviousData: true,
  });

  const handleClearFilters = useCallback(() => {
    setSearchQuery('');
    setSelectedCategory('');
    setSelectedLocation('');
    setCurrentPage(1);
  }, []);

  const handlePageChange = useCallback((event: React.ChangeEvent<unknown>, value: number) => {
    setCurrentPage(value);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const products = catalogData?.data?.products || [];
  const pagination = catalogData?.data?.pagination;
  const appliedFilters = catalogData?.data?.filters?.applied;

  const hasActiveFilters = appliedFilters?.hasQuery || appliedFilters?.hasCategory || appliedFilters?.hasLocation;

  if (filtersError || productsError) {
    return (
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Alert severity="error" sx={{ mb: 2 }}>
          Failed to load product catalog. Please try again later.
        </Alert>
      </Container>
    );
  }

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      {/* Header */}
      <Box sx={{ mb: 4 }}>
        <Typography variant="h3" component="h1" gutterBottom fontWeight="bold">
          Product Catalog
        </Typography>
        <Typography variant="h6" color="text.secondary" sx={{ mb: 3 }}>
          Discover authentic African products with blockchain verification
        </Typography>
        
        {filterOptions?.data && (
          <Typography variant="body2" color="text.secondary">
            {filterOptions.data.availableFilters.totalProducts} verified products available
          </Typography>
        )}
      </Box>

      {/* Search and Filters */}
      <Paper elevation={1} sx={{ p: 3, mb: 4 }}>
        <Grid container spacing={3} alignItems="center">
          {/* Search Field */}
          <Grid item xs={12} md={6}>
            <TextField
              fullWidth
              placeholder="Search products..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon color="action" />
                  </InputAdornment>
                ),
                endAdornment: searchQuery && (
                  <InputAdornment position="end">
                    <Button
                      size="small"
                      onClick={() => setSearchQuery('')}
                      sx={{ minWidth: 'auto', p: 0.5 }}
                    >
                      <ClearIcon fontSize="small" />
                    </Button>
                  </InputAdornment>
                ),
              }}
            />
          </Grid>

          {/* Category Filter */}
          <Grid item xs={12} sm={6} md={3}>
            <FormControl fullWidth disabled={filtersLoading}>
              <InputLabel>Category</InputLabel>
              <Select
                value={selectedCategory}
                label="Category"
                onChange={(e) => {
                  setSelectedCategory(e.target.value);
                  setCurrentPage(1);
                }}
                startAdornment={<CategoryIcon sx={{ mr: 1, color: 'action.active' }} />}
              >
                <MenuItem value="">All Categories</MenuItem>
                {filterOptions?.data?.categories?.map((category) => (
                  <MenuItem key={category} value={category}>
                    {category.charAt(0).toUpperCase() + category.slice(1)}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>

          {/* Location Filter */}
          <Grid item xs={12} sm={6} md={3}>
            <FormControl fullWidth disabled={filtersLoading}>
              <InputLabel>Location</InputLabel>
              <Select
                value={selectedLocation}
                label="Location"
                onChange={(e) => {
                  setSelectedLocation(e.target.value);
                  setCurrentPage(1);
                }}
                startAdornment={<LocationIcon sx={{ mr: 1, color: 'action.active' }} />}
              >
                <MenuItem value="">All Locations</MenuItem>
                {filterOptions?.data?.availableFilters?.countries?.map((country) => (
                  <MenuItem key={country} value={country}>
                    {country}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
        </Grid>

        {/* Active Filters & Clear Button */}
        {hasActiveFilters && (
          <Box sx={{ mt: 2, display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <Typography variant="body2" color="text.secondary">
              Active filters:
            </Typography>
            {appliedFilters?.hasQuery && (
              <Chip
                label={`Search: "${debouncedSearchQuery}"`}
                onDelete={() => setSearchQuery('')}
                size="small"
                variant="outlined"
              />
            )}
            {appliedFilters?.hasCategory && (
              <Chip
                label={`Category: ${selectedCategory}`}
                onDelete={() => setSelectedCategory('')}
                size="small"
                variant="outlined"
              />
            )}
            {appliedFilters?.hasLocation && (
              <Chip
                label={`Location: ${selectedLocation}`}
                onDelete={() => setSelectedLocation('')}
                size="small"
                variant="outlined"
              />
            )}
            <Button
              size="small"
              startIcon={<ClearIcon />}
              onClick={handleClearFilters}
              sx={{ ml: 1 }}
            >
              Clear All
            </Button>
          </Box>
        )}
      </Paper>

      {/* Results Summary */}
      {pagination && (
        <Box sx={{ mb: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography variant="body2" color="text.secondary">
            Showing {products.length} of {pagination.total} products
            {pagination.totalPages > 1 && ` (Page ${pagination.page} of ${pagination.totalPages})`}
          </Typography>
          
          {productsLoading && (
            <Typography variant="body2" color="text.secondary">
              Loading...
            </Typography>
          )}
        </Box>
      )}

      {/* Product Grid */}
      <Grid container spacing={3}>
        {productsLoading ? (
          // Loading skeletons
          Array.from({ length: 12 }).map((_, index) => (
            <Grid item xs={12} sm={6} md={4} key={index}>
              <Card>
                <Skeleton variant="rectangular" height={240} />
                <CardContent>
                  <Skeleton variant="text" sx={{ fontSize: '1.5rem' }} />
                  <Skeleton variant="text" />
                  <Skeleton variant="text" width="60%" />
                </CardContent>
              </Card>
            </Grid>
          ))
        ) : products.length === 0 ? (
          // No results
          <Grid item xs={12}>
            <Paper sx={{ p: 6, textAlign: 'center' }}>
              <FilterIcon sx={{ fontSize: 64, color: 'text.disabled', mb: 2 }} />
              <Typography variant="h6" gutterBottom>
                No products found
              </Typography>
              <Typography color="text.secondary" sx={{ mb: 3 }}>
                Try adjusting your search criteria or filters
              </Typography>
              {hasActiveFilters && (
                <Button variant="outlined" onClick={handleClearFilters}>
                  Clear All Filters
                </Button>
              )}
            </Paper>
          </Grid>
        ) : (
          // Product cards
          products.map((product) => (
            <Grid item xs={12} sm={6} md={4} key={product.id}>
              <Card
                sx={{
                  height: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  transition: 'transform 0.2s, box-shadow 0.2s',
                  '&:hover': {
                    transform: 'translateY(-4px)',
                    boxShadow: (theme) => theme.shadows[8],
                  },
                }}
              >
                <CardMedia
                  component="img"
                  height="240"
                  image={product.primaryImage?.thumbnailUrl || '/placeholder-product.jpg'}
                  alt={product.productName}
                  sx={{
                    objectFit: 'cover',
                    backgroundColor: 'grey.100',
                  }}
                />
                <CardContent sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
                  <Typography variant="h6" component="h2" gutterBottom noWrap>
                    {product.productName}
                  </Typography>
                  
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{
                      flexGrow: 1,
                      mb: 2,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      display: '-webkit-box',
                      WebkitLineClamp: 3,
                      WebkitBoxOrient: 'vertical',
                    }}
                  >
                    {product.description}
                  </Typography>

                  <Divider sx={{ my: 1 }} />

                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    {product.category && (
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <CategoryIcon fontSize="small" color="action" />
                        <Typography variant="caption" color="text.secondary">
                          {product.category.charAt(0).toUpperCase() + product.category.slice(1)}
                        </Typography>
                      </Box>
                    )}
                    
                    {product.manufacturerName && (
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <BusinessIcon fontSize="small" color="action" />
                        <Typography variant="caption" color="text.secondary" noWrap>
                          {product.manufacturerName}
                        </Typography>
                      </Box>
                    )}
                    
                    {product.originCountry && (
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <LocationIcon fontSize="small" color="action" />
                        <Typography variant="caption" color="text.secondary">
                          {product.originCountry}
                        </Typography>
                      </Box>
                    )}
                  </Box>

                  <Box sx={{ mt: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Chip
                      label="Verified"
                      color="success"
                      size="small"
                      variant="outlined"
                    />
                    <Typography variant="caption" color="text.secondary">
                      {product.totalImages} image{product.totalImages !== 1 ? 's' : ''}
                    </Typography>
                  </Box>
                </CardContent>
              </Card>
            </Grid>
          ))
        )}
      </Grid>

      {/* Pagination */}
      {pagination && pagination.totalPages > 1 && (
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>
          <Pagination
            count={pagination.totalPages}
            page={pagination.page}
            onChange={handlePageChange}
            color="primary"
            size="large"
            showFirstButton
            showLastButton
          />
        </Box>
      )}
    </Container>
  );
};