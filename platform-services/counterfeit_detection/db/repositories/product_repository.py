"""
Product repository for database operations.
"""

from typing import List, Optional, Dict, Any
from uuid import UUID, uuid4
from decimal import Decimal
from datetime import datetime

from sqlalchemy import select, update, delete, func, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
import structlog

from ...models.database import Product, Supplier
from ...models.enums import ProductCategory, ProductStatus

logger = structlog.get_logger(module=__name__)


class ProductRepository:
    """Repository for product database operations."""
    
    def __init__(self, session: AsyncSession):
        self.session = session
        self.logger = structlog.get_logger(
            component="product_repository",
            session_id=id(session)
        )
    
    async def create_product(self, product_data: Dict[str, Any]) -> Product:
        """
        Create a new product in the database.
        
        Args:
            product_data: Product data dictionary
            
        Returns:
            Created Product instance
        """
        try:
            # Generate UUID if not provided
            if 'id' not in product_data:
                product_data['id'] = uuid4()
            
            product = Product(**product_data)
            self.session.add(product)
            await self.session.flush()  # Flush to get the ID
            
            self.logger.info(
                "Product created",
                product_id=str(product.id),
                brand=product.brand,
                category=product.category.value
            )
            
            return product
            
        except Exception as e:
            self.logger.error(
                "Failed to create product",
                error=str(e),
                product_data=product_data
            )
            raise
    
    async def get_product_by_id(self, product_id: UUID) -> Optional[Product]:
        """
        Get product by ID with supplier information.
        
        Args:
            product_id: Product UUID
            
        Returns:
            Product instance or None if not found
        """
        try:
            stmt = (
                select(Product)
                .options(selectinload(Product.supplier))
                .where(Product.id == product_id)
            )
            
            result = await self.session.execute(stmt)
            product = result.scalar_one_or_none()
            
            if product:
                self.logger.debug(
                    "Product retrieved",
                    product_id=str(product_id),
                    found=True
                )
            else:
                self.logger.debug(
                    "Product not found",
                    product_id=str(product_id),
                    found=False
                )
            
            return product
            
        except Exception as e:
            self.logger.error(
                "Failed to get product by ID",
                product_id=str(product_id),
                error=str(e)
            )
            raise
    
    async def get_products_by_supplier(
        self, 
        supplier_id: UUID,
        limit: int = 100,
        offset: int = 0,
        status_filter: Optional[ProductStatus] = None
    ) -> List[Product]:
        """
        Get products by supplier with optional filtering.
        
        Args:
            supplier_id: Supplier UUID
            limit: Maximum number of products to return
            offset: Number of products to skip
            status_filter: Optional status filter
            
        Returns:
            List of Product instances
        """
        try:
            stmt = (
                select(Product)
                .options(selectinload(Product.supplier))
                .where(Product.supplier_id == supplier_id)
                .limit(limit)
                .offset(offset)
                .order_by(Product.created_at.desc())
            )
            
            if status_filter:
                stmt = stmt.where(Product.status == status_filter)
            
            result = await self.session.execute(stmt)
            products = result.scalars().all()
            
            self.logger.info(
                "Products retrieved by supplier",
                supplier_id=str(supplier_id),
                count=len(products),
                status_filter=status_filter.value if status_filter else None
            )
            
            return list(products)
            
        except Exception as e:
            self.logger.error(
                "Failed to get products by supplier",
                supplier_id=str(supplier_id),
                error=str(e)
            )
            raise
    
    async def search_products(
        self,
        search_params: Dict[str, Any],
        limit: int = 100,
        offset: int = 0
    ) -> tuple[List[Product], int]:
        """
        Search products with various filters.
        
        Args:
            search_params: Search parameters dictionary
            limit: Maximum number of products to return
            offset: Number of products to skip
            
        Returns:
            Tuple of (products list, total count)
        """
        try:
            # Build base query
            stmt = (
                select(Product)
                .options(selectinload(Product.supplier))
            )
            
            count_stmt = select(func.count(Product.id))
            
            # Apply filters
            conditions = []
            
            if 'category' in search_params:
                conditions.append(Product.category == search_params['category'])
            
            if 'brand' in search_params:
                brand_filter = search_params['brand']
                if isinstance(brand_filter, str):
                    conditions.append(Product.brand.ilike(f"%{brand_filter}%"))
                else:
                    conditions.append(Product.brand.in_(brand_filter))
            
            if 'status' in search_params:
                status_filter = search_params['status']
                if isinstance(status_filter, list):
                    conditions.append(Product.status.in_(status_filter))
                else:
                    conditions.append(Product.status == status_filter)
            
            if 'price_min' in search_params:
                conditions.append(Product.price >= search_params['price_min'])
            
            if 'price_max' in search_params:
                conditions.append(Product.price <= search_params['price_max'])
            
            if 'authenticity_score_min' in search_params:
                conditions.append(Product.authenticity_score >= search_params['authenticity_score_min'])
            
            if 'authenticity_score_max' in search_params:
                conditions.append(Product.authenticity_score <= search_params['authenticity_score_max'])
            
            if 'supplier_id' in search_params:
                conditions.append(Product.supplier_id == search_params['supplier_id'])
            
            if 'description' in search_params:
                description_filter = search_params['description']
                conditions.append(Product.description.ilike(f"%{description_filter}%"))
            
            if 'created_after' in search_params:
                conditions.append(Product.created_at >= search_params['created_after'])
            
            if 'created_before' in search_params:
                conditions.append(Product.created_at <= search_params['created_before'])
            
            # Apply conditions
            if conditions:
                stmt = stmt.where(and_(*conditions))
                count_stmt = count_stmt.where(and_(*conditions))
            
            # Apply ordering
            order_by = search_params.get('order_by', 'created_at')
            order_direction = search_params.get('order_direction', 'desc')
            
            if hasattr(Product, order_by):
                order_column = getattr(Product, order_by)
                if order_direction.lower() == 'asc':
                    stmt = stmt.order_by(order_column.asc())
                else:
                    stmt = stmt.order_by(order_column.desc())
            
            # Apply pagination
            stmt = stmt.limit(limit).offset(offset)
            
            # Execute queries
            products_result = await self.session.execute(stmt)
            products = list(products_result.scalars().all())
            
            count_result = await self.session.execute(count_stmt)
            total_count = count_result.scalar()
            
            self.logger.info(
                "Products search completed",
                filters=search_params,
                returned_count=len(products),
                total_count=total_count
            )
            
            return products, total_count
            
        except Exception as e:
            self.logger.error(
                "Failed to search products",
                search_params=search_params,
                error=str(e)
            )
            raise
    
    async def update_product(
        self, 
        product_id: UUID, 
        update_data: Dict[str, Any]
    ) -> Optional[Product]:
        """
        Update product information.
        
        Args:
            product_id: Product UUID
            update_data: Fields to update
            
        Returns:
            Updated Product instance or None if not found
        """
        try:
            # Add updated timestamp
            update_data['updated_at'] = datetime.utcnow()
            
            stmt = (
                update(Product)
                .where(Product.id == product_id)
                .values(**update_data)
                .returning(Product)
            )
            
            result = await self.session.execute(stmt)
            updated_product = result.scalar_one_or_none()
            
            if updated_product:
                self.logger.info(
                    "Product updated",
                    product_id=str(product_id),
                    updated_fields=list(update_data.keys())
                )
            else:
                self.logger.warning(
                    "Product not found for update",
                    product_id=str(product_id)
                )
            
            return updated_product
            
        except Exception as e:
            self.logger.error(
                "Failed to update product",
                product_id=str(product_id),
                update_data=update_data,
                error=str(e)
            )
            raise
    
    async def update_product_status(
        self, 
        product_id: UUID, 
        status: ProductStatus,
        notes: Optional[str] = None
    ) -> bool:
        """
        Update product status.
        
        Args:
            product_id: Product UUID
            status: New status
            notes: Optional status change notes
            
        Returns:
            True if updated successfully
        """
        try:
            update_data = {
                'status': status,
                'updated_at': datetime.utcnow()
            }
            
            stmt = (
                update(Product)
                .where(Product.id == product_id)
                .values(**update_data)
            )
            
            result = await self.session.execute(stmt)
            
            if result.rowcount > 0:
                self.logger.info(
                    "Product status updated",
                    product_id=str(product_id),
                    new_status=status.value,
                    notes=notes
                )
                return True
            else:
                self.logger.warning(
                    "Product not found for status update",
                    product_id=str(product_id)
                )
                return False
                
        except Exception as e:
            self.logger.error(
                "Failed to update product status",
                product_id=str(product_id),
                status=status.value,
                error=str(e)
            )
            raise
    
    async def update_authenticity_score(
        self,
        product_id: UUID,
        authenticity_score: Decimal,
        confidence_score: Optional[Decimal] = None
    ) -> bool:
        """
        Update product authenticity and confidence scores.
        
        Args:
            product_id: Product UUID
            authenticity_score: Authenticity score (0.0 to 1.0)
            confidence_score: Optional confidence score (0.0 to 1.0)
            
        Returns:
            True if updated successfully
        """
        try:
            update_data = {
                'authenticity_score': authenticity_score,
                'last_analyzed_at': datetime.utcnow(),
                'updated_at': datetime.utcnow()
            }
            
            if confidence_score is not None:
                update_data['confidence_score'] = confidence_score
            
            # Increment analysis count
            stmt = (
                update(Product)
                .where(Product.id == product_id)
                .values(
                    **update_data,
                    analysis_count=Product.analysis_count + 1
                )
            )
            
            result = await self.session.execute(stmt)
            
            if result.rowcount > 0:
                self.logger.info(
                    "Product authenticity score updated",
                    product_id=str(product_id),
                    authenticity_score=float(authenticity_score),
                    confidence_score=float(confidence_score) if confidence_score else None
                )
                return True
            else:
                self.logger.warning(
                    "Product not found for score update",
                    product_id=str(product_id)
                )
                return False
                
        except Exception as e:
            self.logger.error(
                "Failed to update authenticity score",
                product_id=str(product_id),
                authenticity_score=float(authenticity_score),
                error=str(e)
            )
            raise
    
    async def delete_product(self, product_id: UUID) -> bool:
        """
        Delete a product.
        
        Args:
            product_id: Product UUID
            
        Returns:
            True if deleted successfully
        """
        try:
            stmt = delete(Product).where(Product.id == product_id)
            result = await self.session.execute(stmt)
            
            if result.rowcount > 0:
                self.logger.info(
                    "Product deleted",
                    product_id=str(product_id)
                )
                return True
            else:
                self.logger.warning(
                    "Product not found for deletion",
                    product_id=str(product_id)
                )
                return False
                
        except Exception as e:
            self.logger.error(
                "Failed to delete product",
                product_id=str(product_id),
                error=str(e)
            )
            raise
    
    async def get_products_by_category(
        self,
        category: ProductCategory,
        limit: int = 100,
        offset: int = 0
    ) -> List[Product]:
        """
        Get products by category.
        
        Args:
            category: Product category
            limit: Maximum number of products to return
            offset: Number of products to skip
            
        Returns:
            List of Product instances
        """
        try:
            stmt = (
                select(Product)
                .options(selectinload(Product.supplier))
                .where(Product.category == category)
                .order_by(Product.created_at.desc())
                .limit(limit)
                .offset(offset)
            )
            
            result = await self.session.execute(stmt)
            products = list(result.scalars().all())
            
            self.logger.info(
                "Products retrieved by category",
                category=category.value,
                count=len(products)
            )
            
            return products
            
        except Exception as e:
            self.logger.error(
                "Failed to get products by category",
                category=category.value,
                error=str(e)
            )
            raise
    
    async def get_flagged_products(
        self,
        limit: int = 100,
        offset: int = 0
    ) -> List[Product]:
        """
        Get products that have been flagged for review.
        
        Args:
            limit: Maximum number of products to return
            offset: Number of products to skip
            
        Returns:
            List of flagged Product instances
        """
        try:
            stmt = (
                select(Product)
                .options(selectinload(Product.supplier))
                .where(
                    or_(
                        Product.status == ProductStatus.FLAGGED,
                        Product.status == ProductStatus.PENDING_REVIEW,
                        Product.authenticity_score < 0.3  # Low authenticity score
                    )
                )
                .order_by(Product.authenticity_score.asc().nulls_last())
                .limit(limit)
                .offset(offset)
            )
            
            result = await self.session.execute(stmt)
            products = list(result.scalars().all())
            
            self.logger.info(
                "Flagged products retrieved",
                count=len(products)
            )
            
            return products
            
        except Exception as e:
            self.logger.error(
                "Failed to get flagged products",
                error=str(e)
            )
            raise
    
    async def get_statistics(self) -> Dict[str, Any]:
        """
        Get product statistics.
        
        Returns:
            Dictionary with various statistics
        """
        try:
            # Total products
            total_stmt = select(func.count(Product.id))
            total_result = await self.session.execute(total_stmt)
            total_products = total_result.scalar()
            
            # Products by status
            status_stmt = (
                select(Product.status, func.count(Product.id))
                .group_by(Product.status)
            )
            status_result = await self.session.execute(status_stmt)
            status_counts = {status.value: count for status, count in status_result.all()}
            
            # Products by category
            category_stmt = (
                select(Product.category, func.count(Product.id))
                .group_by(Product.category)
            )
            category_result = await self.session.execute(category_stmt)
            category_counts = {category.value: count for category, count in category_result.all()}
            
            # Average authenticity score
            avg_score_stmt = select(func.avg(Product.authenticity_score))
            avg_score_result = await self.session.execute(avg_score_stmt)
            avg_authenticity_score = avg_score_result.scalar()
            
            # Products analyzed
            analyzed_stmt = select(func.count(Product.id)).where(Product.last_analyzed_at.is_not(None))
            analyzed_result = await self.session.execute(analyzed_stmt)
            analyzed_count = analyzed_result.scalar()
            
            statistics = {
                'total_products': total_products,
                'products_by_status': status_counts,
                'products_by_category': category_counts,
                'average_authenticity_score': float(avg_authenticity_score) if avg_authenticity_score else None,
                'analyzed_products': analyzed_count,
                'analysis_coverage': (analyzed_count / total_products * 100) if total_products > 0 else 0
            }
            
            self.logger.info(
                "Product statistics generated",
                total_products=total_products,
                analyzed_products=analyzed_count
            )
            
            return statistics
            
        except Exception as e:
            self.logger.error(
                "Failed to get product statistics",
                error=str(e)
            )
            raise