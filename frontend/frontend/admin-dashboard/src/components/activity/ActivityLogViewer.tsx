/**
 * Activity log viewer component with infinite scroll and real-time updates.
 * 
 * This component displays a comprehensive view of system activities with
 * infinite scrolling, real-time updates, and filtering capabilities.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { FixedSizeList as List } from 'react-window';
import InfiniteLoader from 'react-window-infinite-loader';
import AutoSizer from 'react-virtualized-auto-sizer';
import {
  Box,
  Card,
  CardHeader,
  CardContent,
  TextField,
  InputAdornment,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Chip,
  Typography,
  CircularProgress,
  Alert,
  Toolbar,
  IconButton,
  Tooltip,
  Badge,
} from '@mui/material';
import {
  Search as SearchIcon,
  FilterList as FilterIcon,
  Refresh as RefreshIcon,
  Download as ExportIcon,
  Notifications as NotificationsIcon,
} from '@mui/icons-material';
import { useQuery, useInfiniteQuery } from '@tanstack/react-query';

import { apiService } from '@services/api';
import { webSocketService } from '@services/websocket';
import {
  ActivityLogEntry,
  ActivityFilters,
  ActivityType,
  ActivityStatus,
  AgentType,
} from '@types';
import { ActivityLogItem } from './ActivityLogItem';
import { ActivityFiltersPanel } from './ActivityFiltersPanel';

interface ActivityLogViewerProps {
  initialFilters?: ActivityFilters;
  groupByProduct?: boolean;
  maxHeight?: number;
  enableRealTime?: boolean;
}

const ITEM_HEIGHT = 120;
const PAGE_SIZE = 50;

export const ActivityLogViewer: React.FC<ActivityLogViewerProps> = ({
  initialFilters = {},
  groupByProduct = false,
  maxHeight = 600,
  enableRealTime = true,
}) => {
  const [filters, setFilters] = useState<ActivityFilters>(initialFilters);
  const [searchQuery, setSearchQuery] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [newActivityCount, setNewActivityCount] = useState(0);

  // Infinite query for activities
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    error,
    refetch,
  } = useInfiniteQuery({
    queryKey: ['activities', filters, searchQuery],
    queryFn: async ({ pageParam = 1 }) => {
      const searchFilters = searchQuery ? { ...filters, search_query: searchQuery } : filters;
      return apiService.getActivities(searchFilters, {
        page: pageParam,
        page_size: PAGE_SIZE,
      });
    },
    getNextPageParam: (lastPage) => {
      return lastPage.has_next ? lastPage.page + 1 : undefined;
    },
    staleTime: 30000, // 30 seconds
    refetchInterval: enableRealTime ? 60000 : false, // Refresh every minute if real-time enabled
  });

  // Flatten all activities from all pages
  const allActivities = useMemo(() => {
    return data?.pages.flatMap(page => page.activities) || [];
  }, [data]);

  // Real-time WebSocket updates
  useEffect(() => {
    if (!enableRealTime) return;

    const unsubscribe = webSocketService.onActivityUpdate((update) => {
      // Increment new activity counter instead of immediately refetching
      setNewActivityCount(prev => prev + 1);
    });

    return unsubscribe;
  }, [enableRealTime]);

  // Handle search with debouncing
  const handleSearchChange = useCallback(
    debounce((query: string) => {
      setSearchQuery(query);
      setNewActivityCount(0);
    }, 500),
    []
  );

  // Handle filter changes
  const handleFiltersChange = useCallback((newFilters: ActivityFilters) => {
    setFilters(newFilters);
    setNewActivityCount(0);
  }, []);

  // Handle manual refresh
  const handleRefresh = useCallback(() => {
    refetch();
    setNewActivityCount(0);
  }, [refetch]);

  // Handle export
  const handleExport = useCallback(async () => {
    try {
      // TODO: Implement export functionality
      console.log('Exporting activities with filters:', filters);
    } catch (error) {
      console.error('Export failed:', error);
    }
  }, [filters]);

  // Check if item is loaded
  const isItemLoaded = useCallback(
    (index: number) => !!allActivities[index],
    [allActivities]
  );

  // Load more items
  const loadMoreItems = useCallback(
    (startIndex: number, stopIndex: number) => {
      return hasNextPage && !isFetchingNextPage ? fetchNextPage() : Promise.resolve();
    },
    [hasNextPage, isFetchingNextPage, fetchNextPage]
  );

  // Render individual activity item
  const renderActivityItem = useCallback(
    ({ index, style }: { index: number; style: React.CSSProperties }) => {
      const activity = allActivities[index];
      
      if (!activity) {
        return (
          <div style={style}>
            <Box display="flex" justifyContent="center" alignItems="center" height={ITEM_HEIGHT}>
              <CircularProgress size={24} />
            </Box>
          </div>
        );
      }

      return (
        <div style={style}>
          <ActivityLogItem 
            activity={activity} 
            groupByProduct={groupByProduct}
          />
        </div>
      );
    },
    [allActivities, groupByProduct]
  );

  if (error) {
    return (
      <Alert severity="error" sx={{ m: 2 }}>
        Failed to load activities: {error.message}
      </Alert>
    );
  }

  return (
    <Box>
      {/* Toolbar */}
      <Card sx={{ mb: 2 }}>
        <Toolbar sx={{ gap: 2, flexWrap: 'wrap' }}>
          {/* Search */}
          <TextField
            placeholder="Search activities..."
            size="small"
            sx={{ minWidth: 300 }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon />
                </InputAdornment>
              ),
            }}
            onChange={(e) => handleSearchChange(e.target.value)}
          />

          {/* Filters button */}
          <Tooltip title="Toggle filters">
            <IconButton
              onClick={() => setShowFilters(!showFilters)}
              color={showFilters ? 'primary' : 'default'}
            >
              <FilterIcon />
            </IconButton>
          </Tooltip>

          {/* Refresh button */}
          <Tooltip title="Refresh">
            <IconButton onClick={handleRefresh} disabled={isLoading}>
              <Badge badgeContent={newActivityCount} color="error">
                <RefreshIcon />
              </Badge>
            </IconButton>
          </Tooltip>

          {/* Export button */}
          <Tooltip title="Export activities">
            <IconButton onClick={handleExport}>
              <ExportIcon />
            </IconButton>
          </Tooltip>

          {/* Real-time indicator */}
          {enableRealTime && (
            <Chip
              icon={<NotificationsIcon />}
              label="Live"
              color="success"
              size="small"
              variant="outlined"
            />
          )}

          {/* Activity count */}
          <Typography variant="body2" color="text.secondary" sx={{ ml: 'auto' }}>
            {data?.pages[0]?.total_count?.toLocaleString() || 0} activities
          </Typography>
        </Toolbar>
      </Card>

      {/* Filters panel */}
      {showFilters && (
        <Card sx={{ mb: 2 }}>
          <CardContent>
            <ActivityFiltersPanel
              filters={filters}
              onChange={handleFiltersChange}
            />
          </CardContent>
        </Card>
      )}

      {/* Activity list */}
      <Card>
        <CardHeader title="Activity Log" />
        <CardContent sx={{ p: 0 }}>
          {isLoading && allActivities.length === 0 ? (
            <Box display="flex" justifyContent="center" alignItems="center" height={200}>
              <CircularProgress />
            </Box>
          ) : allActivities.length === 0 ? (
            <Box p={3} textAlign="center">
              <Typography color="text.secondary">
                No activities found for the current filters
              </Typography>
            </Box>
          ) : (
            <Box height={maxHeight}>
              <AutoSizer>
                {({ height, width }) => (
                  <InfiniteLoader
                    isItemLoaded={isItemLoaded}
                    itemCount={hasNextPage ? allActivities.length + 1 : allActivities.length}
                    loadMoreItems={loadMoreItems}
                  >
                    {({ onItemsRendered, ref }) => (
                      <List
                        ref={ref}
                        height={height}
                        width={width}
                        itemCount={hasNextPage ? allActivities.length + 1 : allActivities.length}
                        itemSize={ITEM_HEIGHT}
                        onItemsRendered={onItemsRendered}
                      >
                        {renderActivityItem}
                      </List>
                    )}
                  </InfiniteLoader>
                )}
              </AutoSizer>
            </Box>
          )}

          {/* Loading indicator for infinite scroll */}
          {isFetchingNextPage && (
            <Box display="flex" justifyContent="center" p={2}>
              <CircularProgress size={24} />
            </Box>
          )}
        </CardContent>
      </Card>
    </Box>
  );
};

// Debounce utility function
function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout;
  return function executedFunction(...args: Parameters<T>) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}