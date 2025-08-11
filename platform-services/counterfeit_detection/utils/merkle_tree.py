"""
Merkle Tree implementation for cryptographic audit trails.

Provides efficient and secure Merkle tree construction and verification
for immutable audit trail systems with optimal proof generation.
"""

import hashlib
import math
from typing import List, Dict, Any, Tuple, Optional
from dataclasses import dataclass


@dataclass
class MerkleProof:
    """Merkle proof data structure."""
    leaf_hash: str
    leaf_index: int
    proof_path: List[Dict[str, Any]]
    root_hash: str
    tree_size: int


@dataclass
class MerkleNode:
    """Merkle tree node."""
    hash: str
    left: Optional['MerkleNode'] = None
    right: Optional['MerkleNode'] = None
    is_leaf: bool = False
    leaf_index: Optional[int] = None


class MerkleTree:
    """
    Cryptographic Merkle tree implementation for audit trails.
    
    Provides efficient construction, proof generation, and verification
    with support for unbalanced trees and incremental updates.
    """
    
    def __init__(self):
        """Initialize Merkle tree."""
        self.hash_function = hashlib.sha256
        self.empty_hash = self.hash_function(b"").hexdigest()
    
    def build_tree(self, leaf_hashes: List[str]) -> str:
        """
        Build Merkle tree and return root hash.
        
        Args:
            leaf_hashes: List of leaf node hashes
            
        Returns:
            Root hash of the tree
        """
        if not leaf_hashes:
            return self.empty_hash
        
        if len(leaf_hashes) == 1:
            return leaf_hashes[0]
        
        # Build tree bottom-up
        current_level = leaf_hashes[:]
        
        while len(current_level) > 1:
            next_level = []
            
            # Process pairs of nodes
            for i in range(0, len(current_level), 2):
                left_hash = current_level[i]
                
                if i + 1 < len(current_level):
                    right_hash = current_level[i + 1]
                else:
                    # Odd number of nodes - duplicate the last one
                    right_hash = left_hash
                
                # Combine hashes
                parent_hash = self._combine_hashes(left_hash, right_hash)
                next_level.append(parent_hash)
            
            current_level = next_level
        
        return current_level[0]
    
    def build_tree_with_proofs(
        self, 
        leaf_hashes: List[str]
    ) -> Tuple[str, Dict[str, Any]]:
        """
        Build Merkle tree and generate proof data for all leaves.
        
        Args:
            leaf_hashes: List of leaf node hashes
            
        Returns:
            Tuple of (root_hash, proof_data_structure)
        """
        if not leaf_hashes:
            return self.empty_hash, {}
        
        # Build tree with node tracking
        tree_data = self._build_tree_with_nodes(leaf_hashes)
        root_hash = tree_data["root_hash"]
        
        # Generate proofs for all leaves
        proof_data = {
            "root_hash": root_hash,
            "tree_size": len(leaf_hashes),
            "tree_depth": self.calculate_tree_depth(len(leaf_hashes)),
            "leaf_proofs": {},
            "tree_structure": tree_data["tree_structure"]
        }
        
        for i, leaf_hash in enumerate(leaf_hashes):
            proof = self.generate_proof(leaf_hashes, i)
            proof_data["leaf_proofs"][str(i)] = {
                "leaf_hash": leaf_hash,
                "proof_path": proof.proof_path,
                "leaf_index": i
            }
        
        return root_hash, proof_data
    
    def generate_proof(self, leaf_hashes: List[str], leaf_index: int) -> MerkleProof:
        """
        Generate Merkle proof for a specific leaf.
        
        Args:
            leaf_hashes: List of all leaf hashes
            leaf_index: Index of the leaf to prove
            
        Returns:
            Merkle proof for the leaf
        """
        if leaf_index < 0 or leaf_index >= len(leaf_hashes):
            raise ValueError(f"Invalid leaf index: {leaf_index}")
        
        root_hash = self.build_tree(leaf_hashes)
        proof_path = self._generate_proof_path(leaf_hashes, leaf_index)
        
        return MerkleProof(
            leaf_hash=leaf_hashes[leaf_index],
            leaf_index=leaf_index,
            proof_path=proof_path,
            root_hash=root_hash,
            tree_size=len(leaf_hashes)
        )
    
    def verify_proof(
        self, 
        leaf_hash: str, 
        proof_data: Dict[str, Any], 
        expected_root: str,
        leaf_index: Optional[int] = None
    ) -> bool:
        """
        Verify Merkle proof for a leaf.
        
        Args:
            leaf_hash: Hash of the leaf to verify
            proof_data: Proof data structure
            expected_root: Expected root hash
            leaf_index: Index of the leaf (optional)
            
        Returns:
            True if proof is valid, False otherwise
        """
        try:
            if isinstance(proof_data, dict) and "leaf_proofs" in proof_data:
                # Extract proof from full tree data
                if leaf_index is None:
                    # Find leaf index by hash
                    for idx, proof_info in proof_data["leaf_proofs"].items():
                        if proof_info["leaf_hash"] == leaf_hash:
                            leaf_index = int(idx)
                            break
                    
                    if leaf_index is None:
                        return False
                
                proof_info = proof_data["leaf_proofs"].get(str(leaf_index))
                if not proof_info:
                    return False
                
                proof_path = proof_info["proof_path"]
            else:
                # Direct proof path
                proof_path = proof_data
            
            # Verify proof by reconstructing path to root
            current_hash = leaf_hash
            current_index = leaf_index or 0
            
            for proof_element in proof_path:
                sibling_hash = proof_element["hash"]
                is_left = proof_element["is_left"]
                
                if is_left:
                    # Current node is on the right, sibling on the left
                    current_hash = self._combine_hashes(sibling_hash, current_hash)
                else:
                    # Current node is on the left, sibling on the right
                    current_hash = self._combine_hashes(current_hash, sibling_hash)
                
                # Move up one level
                current_index = current_index // 2
            
            return current_hash == expected_root
            
        except Exception as e:
            return False
    
    def calculate_tree_depth(self, leaf_count: int) -> int:
        """Calculate the depth of a Merkle tree with given leaf count."""
        if leaf_count <= 1:
            return 1
        return math.ceil(math.log2(leaf_count)) + 1
    
    def get_tree_size_for_depth(self, depth: int) -> int:
        """Get maximum number of leaves for a given tree depth."""
        return 2 ** (depth - 1)
    
    def verify_tree_consistency(
        self, 
        leaf_hashes: List[str], 
        expected_root: str
    ) -> bool:
        """
        Verify that the leaf hashes produce the expected root.
        
        Args:
            leaf_hashes: List of leaf hashes
            expected_root: Expected root hash
            
        Returns:
            True if tree is consistent, False otherwise
        """
        calculated_root = self.build_tree(leaf_hashes)
        return calculated_root == expected_root
    
    def update_tree_with_new_leaf(
        self, 
        existing_leaves: List[str], 
        new_leaf: str
    ) -> Tuple[str, MerkleProof]:
        """
        Add a new leaf to existing tree and return new root with proof.
        
        Args:
            existing_leaves: Current leaf hashes
            new_leaf: New leaf hash to add
            
        Returns:
            Tuple of (new_root_hash, proof_for_new_leaf)
        """
        updated_leaves = existing_leaves + [new_leaf]
        new_root = self.build_tree(updated_leaves)
        new_leaf_proof = self.generate_proof(updated_leaves, len(updated_leaves) - 1)
        
        return new_root, new_leaf_proof
    
    def batch_verify_proofs(
        self, 
        proofs: List[MerkleProof], 
        expected_root: str
    ) -> Dict[int, bool]:
        """
        Verify multiple proofs in batch.
        
        Args:
            proofs: List of Merkle proofs to verify
            expected_root: Expected root hash
            
        Returns:
            Dictionary mapping leaf indices to verification results
        """
        results = {}
        
        for proof in proofs:
            is_valid = self.verify_proof(
                proof.leaf_hash,
                proof.proof_path,
                expected_root,
                proof.leaf_index
            )
            results[proof.leaf_index] = is_valid
        
        return results
    
    def create_subtree_proof(
        self, 
        leaf_hashes: List[str], 
        start_index: int, 
        end_index: int
    ) -> Dict[str, Any]:
        """
        Create proof for a range of leaves (subtree).
        
        Args:
            leaf_hashes: All leaf hashes
            start_index: Start index of subtree
            end_index: End index of subtree (exclusive)
            
        Returns:
            Subtree proof data
        """
        if start_index < 0 or end_index > len(leaf_hashes) or start_index >= end_index:
            raise ValueError("Invalid subtree range")
        
        # Extract subtree leaves
        subtree_leaves = leaf_hashes[start_index:end_index]
        subtree_root = self.build_tree(subtree_leaves)
        
        # Generate proof that subtree is part of main tree
        # This is a simplified implementation - full implementation would need
        # more sophisticated subtree proof generation
        main_tree_root = self.build_tree(leaf_hashes)
        
        return {
            "subtree_root": subtree_root,
            "subtree_leaves": subtree_leaves,
            "start_index": start_index,
            "end_index": end_index,
            "main_tree_root": main_tree_root,
            "subtree_size": len(subtree_leaves)
        }
    
    # Helper methods
    
    def _combine_hashes(self, left_hash: str, right_hash: str) -> str:
        """Combine two hashes to create parent hash."""
        combined = left_hash + right_hash
        return self.hash_function(combined.encode()).hexdigest()
    
    def _generate_proof_path(
        self, 
        leaf_hashes: List[str], 
        leaf_index: int
    ) -> List[Dict[str, Any]]:
        """Generate proof path for a specific leaf."""
        if len(leaf_hashes) <= 1:
            return []
        
        proof_path = []
        current_level = leaf_hashes[:]
        current_index = leaf_index
        
        while len(current_level) > 1:
            # Find sibling
            if current_index % 2 == 0:
                # Current node is left child
                if current_index + 1 < len(current_level):
                    sibling_hash = current_level[current_index + 1]
                    is_left = False  # Sibling is on the right
                else:
                    # No right sibling, use left node itself (duplicate)
                    sibling_hash = current_level[current_index]
                    is_left = False
            else:
                # Current node is right child
                sibling_hash = current_level[current_index - 1]
                is_left = True  # Sibling is on the left
            
            proof_path.append({
                "hash": sibling_hash,
                "is_left": is_left,
                "level": len(proof_path)
            })
            
            # Move to next level
            next_level = []
            for i in range(0, len(current_level), 2):
                left_hash = current_level[i]
                
                if i + 1 < len(current_level):
                    right_hash = current_level[i + 1]
                else:
                    right_hash = left_hash
                
                parent_hash = self._combine_hashes(left_hash, right_hash)
                next_level.append(parent_hash)
            
            current_level = next_level
            current_index = current_index // 2
        
        return proof_path
    
    def _build_tree_with_nodes(self, leaf_hashes: List[str]) -> Dict[str, Any]:
        """Build tree and return detailed structure."""
        if not leaf_hashes:
            return {"root_hash": self.empty_hash, "tree_structure": {}}
        
        # Create leaf nodes
        nodes = []
        for i, leaf_hash in enumerate(leaf_hashes):
            node = MerkleNode(
                hash=leaf_hash,
                is_leaf=True,
                leaf_index=i
            )
            nodes.append(node)
        
        level_nodes = nodes[:]
        tree_levels = [level_nodes[:]]
        
        # Build tree level by level
        while len(level_nodes) > 1:
            next_level = []
            
            for i in range(0, len(level_nodes), 2):
                left_node = level_nodes[i]
                
                if i + 1 < len(level_nodes):
                    right_node = level_nodes[i + 1]
                else:
                    # Duplicate last node for odd number
                    right_node = left_node
                
                # Create parent node
                parent_hash = self._combine_hashes(left_node.hash, right_node.hash)
                parent_node = MerkleNode(
                    hash=parent_hash,
                    left=left_node,
                    right=right_node,
                    is_leaf=False
                )
                
                next_level.append(parent_node)
            
            level_nodes = next_level
            tree_levels.append(level_nodes[:])
        
        root_node = level_nodes[0] if level_nodes else None
        
        return {
            "root_hash": root_node.hash if root_node else self.empty_hash,
            "tree_structure": {
                "levels": len(tree_levels),
                "leaf_count": len(leaf_hashes),
                "total_nodes": sum(len(level) for level in tree_levels),
                "is_complete": self._is_complete_tree(len(leaf_hashes))
            }
        }
    
    def _is_complete_tree(self, leaf_count: int) -> bool:
        """Check if tree with given leaf count is complete (power of 2)."""
        return leaf_count > 0 and (leaf_count & (leaf_count - 1)) == 0


class OptimizedMerkleTree(MerkleTree):
    """
    Optimized Merkle tree with caching and incremental updates.
    
    Provides better performance for large trees and frequent updates
    with memory-efficient caching and parallel computation support.
    """
    
    def __init__(self, cache_size: int = 10000):
        """Initialize optimized Merkle tree with caching."""
        super().__init__()
        self.cache_size = cache_size
        self.hash_cache = {}
        self.proof_cache = {}
    
    def build_tree_cached(self, leaf_hashes: List[str]) -> str:
        """Build tree with caching for better performance."""
        cache_key = self._generate_cache_key(leaf_hashes)
        
        if cache_key in self.hash_cache:
            return self.hash_cache[cache_key]
        
        root_hash = self.build_tree(leaf_hashes)
        
        # Cache result if within size limit
        if len(self.hash_cache) < self.cache_size:
            self.hash_cache[cache_key] = root_hash
        
        return root_hash
    
    def generate_proof_cached(
        self, 
        leaf_hashes: List[str], 
        leaf_index: int
    ) -> MerkleProof:
        """Generate proof with caching."""
        cache_key = f"{self._generate_cache_key(leaf_hashes)}:{leaf_index}"
        
        if cache_key in self.proof_cache:
            return self.proof_cache[cache_key]
        
        proof = self.generate_proof(leaf_hashes, leaf_index)
        
        # Cache result if within size limit
        if len(self.proof_cache) < self.cache_size:
            self.proof_cache[cache_key] = proof
        
        return proof
    
    def clear_cache(self) -> None:
        """Clear all caches."""
        self.hash_cache.clear()
        self.proof_cache.clear()
    
    def get_cache_stats(self) -> Dict[str, int]:
        """Get cache statistics."""
        return {
            "hash_cache_size": len(self.hash_cache),
            "proof_cache_size": len(self.proof_cache),
            "max_cache_size": self.cache_size
        }
    
    def _generate_cache_key(self, leaf_hashes: List[str]) -> str:
        """Generate cache key for leaf hash list."""
        combined = "".join(leaf_hashes)
        return self.hash_function(combined.encode()).hexdigest()[:16]


class IncrementalMerkleTree:
    """
    Incremental Merkle tree that supports efficient appends.
    
    Optimized for audit logs where new entries are frequently added
    and historical proofs need to remain valid.
    """
    
    def __init__(self):
        """Initialize incremental Merkle tree."""
        self.base_tree = MerkleTree()
        self.leaf_hashes = []
        self.cached_roots = {}
        self.cached_proofs = {}
    
    def append_leaf(self, leaf_hash: str) -> Tuple[str, int]:
        """
        Append new leaf and return new root hash and leaf index.
        
        Args:
            leaf_hash: Hash of new leaf
            
        Returns:
            Tuple of (new_root_hash, leaf_index)
        """
        self.leaf_hashes.append(leaf_hash)
        leaf_index = len(self.leaf_hashes) - 1
        
        # Calculate new root
        new_root = self.base_tree.build_tree(self.leaf_hashes)
        
        # Cache root for this size
        self.cached_roots[len(self.leaf_hashes)] = new_root
        
        return new_root, leaf_index
    
    def get_current_root(self) -> str:
        """Get current root hash."""
        if not self.leaf_hashes:
            return self.base_tree.empty_hash
        
        size = len(self.leaf_hashes)
        if size in self.cached_roots:
            return self.cached_roots[size]
        
        root = self.base_tree.build_tree(self.leaf_hashes)
        self.cached_roots[size] = root
        return root
    
    def get_proof_at_size(self, leaf_index: int, tree_size: int) -> MerkleProof:
        """
        Get proof for leaf at a specific tree size (historical proof).
        
        Args:
            leaf_index: Index of leaf to prove
            tree_size: Size of tree when proof was valid
            
        Returns:
            Historical Merkle proof
        """
        if tree_size > len(self.leaf_hashes) or leaf_index >= tree_size:
            raise ValueError("Invalid tree size or leaf index")
        
        cache_key = f"{leaf_index}:{tree_size}"
        if cache_key in self.cached_proofs:
            return self.cached_proofs[cache_key]
        
        # Generate proof for historical tree state
        historical_leaves = self.leaf_hashes[:tree_size]
        proof = self.base_tree.generate_proof(historical_leaves, leaf_index)
        
        # Cache the proof
        self.cached_proofs[cache_key] = proof
        
        return proof
    
    def get_inclusion_proof(self, leaf_index: int) -> MerkleProof:
        """Get current inclusion proof for a leaf."""
        return self.base_tree.generate_proof(self.leaf_hashes, leaf_index)
    
    def verify_historical_proof(
        self, 
        proof: MerkleProof, 
        tree_size: int
    ) -> bool:
        """Verify a historical proof against historical tree state."""
        if tree_size > len(self.leaf_hashes):
            return False
        
        historical_leaves = self.leaf_hashes[:tree_size]
        historical_root = self.base_tree.build_tree(historical_leaves)
        
        return self.base_tree.verify_proof(
            proof.leaf_hash,
            proof.proof_path,
            historical_root,
            proof.leaf_index
        )
    
    def get_tree_stats(self) -> Dict[str, Any]:
        """Get tree statistics."""
        return {
            "total_leaves": len(self.leaf_hashes),
            "current_root": self.get_current_root(),
            "tree_depth": self.base_tree.calculate_tree_depth(len(self.leaf_hashes)),
            "cached_roots": len(self.cached_roots),
            "cached_proofs": len(self.cached_proofs)
        }