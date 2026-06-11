// Reusable D3 force-directed graph component.
// React owns the SVG ref. All D3 mutations happen inside useEffect against svgRef.
// On unmount, the simulation is stopped and listeners detached.

import React, { useEffect, useRef } from 'react';
import * as d3 from 'd3';

const STATUS_COLORS = {
  hot: '#e85d3a',
  warm: '#e8a23a',
  cold: '#6b8cae',
  connected: '#4caf82',
};
const DONOR_COLOR = '#ffffff';

export default function ForceGraph({
  nodes,
  edges,
  height = 600,
  onNodeClick,
  centerNodeId, // optional — if provided, this node is pinned at the center
}) {
  const svgRef = useRef(null);
  const containerRef = useRef(null);

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    if (!nodes || nodes.length === 0) {
      svg.selectAll('*').remove();
      return;
    }

    const container = containerRef.current;
    const width = container ? container.clientWidth : 800;

    svg.attr('viewBox', `0 0 ${width} ${height}`);
    svg.selectAll('*').remove();

    // Deep-clone nodes/edges because d3 mutates them (adds x, y, vx, vy, fx, fy)
    const nodesCopy = nodes.map((n) => ({ ...n }));
    const edgesCopy = edges.map((e) => ({ ...e }));

    if (centerNodeId) {
      const c = nodesCopy.find((n) => n.id === centerNodeId);
      if (c) { c.fx = width / 2; c.fy = height / 2; }
    }

    const root = svg.append('g');

    // Zoom + pan
    const zoom = d3.zoom()
      .scaleExtent([0.2, 4])
      .on('zoom', (event) => root.attr('transform', event.transform));
    svg.call(zoom);

    // Edges
    const linkSel = root.append('g')
      .attr('stroke', '#e8a23a')
      .attr('stroke-opacity', 0.35)
      .attr('stroke-width', 1)
      .selectAll('line')
      .data(edgesCopy)
      .join('line');

    // Nodes
    const nodeSel = root.append('g')
      .selectAll('g')
      .data(nodesCopy)
      .join('g')
      .style('cursor', 'pointer')
      .call(drag());

    nodeSel.append('circle')
      .attr('r', (d) => d.type === 'donor' ? 24 : 16)
      .attr('fill', (d) => d.type === 'donor' ? DONOR_COLOR : (STATUS_COLORS[d.status] || '#6b8cae'))
      .attr('stroke', (d) => d.type === 'donor' ? '#ffffff' : '#0a1321')
      .attr('stroke-width', (d) => d.type === 'donor' ? 2 : 2);

    nodeSel.append('text')
      .text((d) => d.label)
      .attr('text-anchor', 'middle')
      .attr('dy', (d) => d.type === 'donor' ? 38 : 30)
      .attr('fill', '#e6ecf5')
      .attr('font-size', (d) => d.type === 'donor' ? 12 : 11)
      .attr('font-weight', (d) => d.type === 'donor' ? 600 : 400)
      .attr('pointer-events', 'none');

    // Hover highlight: dim unconnected nodes + edges
    function getConnectedIds(nodeId) {
      const ids = new Set([nodeId]);
      for (const e of edgesCopy) {
        const sId = typeof e.source === 'object' ? e.source.id : e.source;
        const tId = typeof e.target === 'object' ? e.target.id : e.target;
        if (sId === nodeId) ids.add(tId);
        if (tId === nodeId) ids.add(sId);
      }
      return ids;
    }
    nodeSel.on('mouseenter', (event, d) => {
      const connected = getConnectedIds(d.id);
      nodeSel.attr('opacity', (n) => connected.has(n.id) ? 1 : 0.15);
      linkSel.attr('opacity', (e) => {
        const sId = typeof e.source === 'object' ? e.source.id : e.source;
        const tId = typeof e.target === 'object' ? e.target.id : e.target;
        return (sId === d.id || tId === d.id) ? 1 : 0.05;
      });
    }).on('mouseleave', () => {
      nodeSel.attr('opacity', 1);
      linkSel.attr('opacity', 1);
    });

    nodeSel.on('click', (event, d) => {
      event.stopPropagation();
      if (onNodeClick) onNodeClick(d);
    });

    // Force simulation
    //   - link distance increased (110 → 170) so connected nodes don't crowd
    //   - charge strength made more negative so nodes repel each other harder
    //   - collide radius = node radius (24/16) + padding (16) to guarantee no overlap
    //   - higher iterationCount on collide makes the no-overlap constraint stricter
    const simulation = d3.forceSimulation(nodesCopy)
      .force('link', d3.forceLink(edgesCopy).id((d) => d.id).distance(170).strength(0.4))
      .force('charge', d3.forceManyBody().strength((d) => d.type === 'donor' ? -1200 : -500))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collide', d3.forceCollide()
        .radius((d) => (d.type === 'donor' ? 24 : 16) + 16)
        .strength(1)
        .iterations(3));

    simulation.on('tick', () => {
      linkSel
        .attr('x1', (d) => d.source.x)
        .attr('y1', (d) => d.source.y)
        .attr('x2', (d) => d.target.x)
        .attr('y2', (d) => d.target.y);
      nodeSel.attr('transform', (d) => `translate(${d.x},${d.y})`);
    });

    function drag() {
      function started(event, d) {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x; d.fy = d.y;
      }
      function dragged(event, d) {
        d.fx = event.x; d.fy = event.y;
      }
      function ended(event, d) {
        if (!event.active) simulation.alphaTarget(0);
        // Keep centerNode pinned, release all others
        if (d.id !== centerNodeId) { d.fx = null; d.fy = null; }
      }
      return d3.drag().on('start', started).on('drag', dragged).on('end', ended);
    }

    // Cleanup
    return () => {
      simulation.stop();
      svg.on('.zoom', null);
      svg.selectAll('*').remove();
    };
  }, [nodes, edges, height, centerNodeId, onNodeClick]);

  return (
    <div ref={containerRef} style={{ width: '100%' }}>
      <svg
        ref={svgRef}
        width="100%"
        height={height}
        style={{ background: 'var(--bg-elev)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}
      />
    </div>
  );
}
