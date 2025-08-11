/**
 * Sidebar navigation component.
 * 
 * This component provides the main navigation menu with
 * dashboard sections and quick filters.
 */

import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Box,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Typography,
  Divider,
  Chip,
  useTheme,
} from '@mui/material';
import {
  Dashboard as DashboardIcon,
  Inventory as ProductsIcon,
  Analytics as AnalyticsIcon,
  Security as SecurityIcon,
  NotificationsActive as AlertsIcon,
  Settings as SettingsIcon,
  Assessment as ReportsIcon,
  Group as SuppliersIcon,
  Rule as RulesIcon,
  Timeline as ActivityIcon,
} from '@mui/icons-material';

interface NavigationItem {
  id: string;
  label: string;
  icon: React.ElementType;
  path: string;
  badge?: string | number;
  children?: NavigationItem[];
}

interface SidebarProps {
  onItemClick?: () => void;
}

const navigationItems: NavigationItem[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: DashboardIcon,
    path: '/',
  },
  {
    id: 'products',
    label: 'Products',
    icon: ProductsIcon,
    path: '/products',
    badge: '2,456',
    children: [
      { id: 'products-all', label: 'All Products', icon: ProductsIcon, path: '/products' },
      { id: 'products-flagged', label: 'Flagged', icon: SecurityIcon, path: '/products?status=flagged', badge: '23' },
      { id: 'products-high-risk', label: 'High Risk', icon: AlertsIcon, path: '/products?risk=high', badge: '12' },
    ],
  },
  {
    id: 'analytics',
    label: 'Analytics',
    icon: AnalyticsIcon,
    path: '/analytics',
  },
  {
    id: 'activity',
    label: 'Activity',
    icon: ActivityIcon,
    path: '/activity',
    badge: 'Live',
  },
  {
    id: 'suppliers',
    label: 'Suppliers',
    icon: SuppliersIcon,
    path: '/suppliers',
  },
  {
    id: 'rules',
    label: 'Detection Rules',
    icon: RulesIcon,
    path: '/rules',
  },
  {
    id: 'reports',
    label: 'Reports',
    icon: ReportsIcon,
    path: '/reports',
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: SettingsIcon,
    path: '/settings',
  },
];

const quickFilters = [
  { label: "Today's Flagged", count: 23, path: '/products?flagged_today=true' },
  { label: 'High Risk', count: 12, path: '/products?risk=high' },
  { label: 'Pending Review', count: 8, path: '/products?status=under_review' },
  { label: 'Recent Appeals', count: 4, path: '/appeals?recent=true' },
];

export const Sidebar: React.FC<SidebarProps> = ({ onItemClick }) => {
  const theme = useTheme();
  const location = useLocation();
  const navigate = useNavigate();

  const handleNavigation = (path: string) => {
    navigate(path);
    onItemClick?.();
  };

  const isActive = (path: string) => {
    if (path === '/') {
      return location.pathname === '/';
    }
    return location.pathname.startsWith(path);
  };

  const renderNavigationItem = (item: NavigationItem, level = 0) => {
    const Icon = item.icon;
    const active = isActive(item.path);

    return (
      <ListItem
        key={item.id}
        disablePadding
        sx={{
          pl: level * 2,
        }}
      >
        <ListItemButton
          onClick={() => handleNavigation(item.path)}
          selected={active}
          sx={{
            borderRadius: 2,
            mx: 1,
            mb: 0.5,
            '&.Mui-selected': {
              backgroundColor: theme.palette.primary.main + '12',
              '&:hover': {
                backgroundColor: theme.palette.primary.main + '20',
              },
            },
          }}
        >
          <ListItemIcon
            sx={{
              color: active ? 'primary.main' : 'text.secondary',
              minWidth: 40,
            }}
          >
            <Icon fontSize="small" />
          </ListItemIcon>
          <ListItemText
            primary={item.label}
            primaryTypographyProps={{
              fontSize: '0.875rem',
              fontWeight: active ? 600 : 400,
              color: active ? 'primary.main' : 'text.primary',
            }}
          />
          {item.badge && (
            <Chip
              label={item.badge}
              size="small"
              color={typeof item.badge === 'string' && item.badge === 'Live' ? 'success' : 'default'}
              sx={{
                height: 20,
                fontSize: '0.75rem',
                '& .MuiChip-label': {
                  px: 1,
                },
              }}
            />
          )}
        </ListItemButton>
      </ListItem>
    );
  };

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Logo area */}
      <Box sx={{ p: 3, borderBottom: 1, borderColor: 'divider' }}>
        <Typography variant="h6" sx={{ fontWeight: 700, color: 'primary.main' }}>
          Detection System
        </Typography>
        <Typography variant="caption" color="text.secondary">
          Admin Dashboard
        </Typography>
      </Box>

      {/* Main navigation */}
      <Box sx={{ flex: 1, overflow: 'auto' }}>
        <List sx={{ px: 1, py: 2 }}>
          {navigationItems.map((item) => (
            <React.Fragment key={item.id}>
              {renderNavigationItem(item)}
              {item.children?.map((child) => renderNavigationItem(child, 1))}
            </React.Fragment>
          ))}
        </List>

        <Divider sx={{ mx: 2 }} />

        {/* Quick filters */}
        <Box sx={{ p: 2 }}>
          <Typography
            variant="overline"
            sx={{
              fontSize: '0.75rem',
              fontWeight: 600,
              color: 'text.secondary',
              mb: 1,
              display: 'block',
            }}
          >
            Quick Filters
          </Typography>
          <List dense>
            {quickFilters.map((filter) => (
              <ListItem key={filter.label} disablePadding>
                <ListItemButton
                  onClick={() => handleNavigation(filter.path)}
                  sx={{
                    borderRadius: 1,
                    py: 0.5,
                    px: 1,
                  }}
                >
                  <ListItemText
                    primary={filter.label}
                    primaryTypographyProps={{
                      fontSize: '0.8rem',
                    }}
                  />
                  <Chip
                    label={filter.count}
                    size="small"
                    variant="outlined"
                    sx={{
                      height: 18,
                      fontSize: '0.7rem',
                      '& .MuiChip-label': {
                        px: 0.5,
                      },
                    }}
                  />
                </ListItemButton>
              </ListItem>
            ))}
          </List>
        </Box>
      </Box>

      {/* Footer */}
      <Box sx={{ p: 2, borderTop: 1, borderColor: 'divider' }}>
        <Typography variant="caption" color="text.secondary" align="center" display="block">
          Version 1.0.0
        </Typography>
        <Typography variant="caption" color="text.secondary" align="center" display="block">
          © 2025 Detection System
        </Typography>
      </Box>
    </Box>
  );
};