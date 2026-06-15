import React, { useMemo, useState } from 'react';
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  DragOverlay,
  closestCenter,
} from '@dnd-kit/core';
import { Zap, GripVertical } from 'lucide-react';
import { STAGES, STAGE_COLORS, fmtMoney, displaySuggestedAsk } from './ProspectList.jsx';

/**
 * KanbanBoard
 * Props:
 *   prospects: array of prospect records (already filtered/sorted)
 *   onStageChange(prospectId, newStage): called when a card is dropped on a new column
 *   onSelect(prospectId): called when card is clicked (not dragged)
 */
export default function KanbanBoard({ prospects, onStageChange, onSelect }) {
  const [activeId, setActiveId] = useState(null);

  // Require a small drag distance so clicks still register as selection.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  // Group prospects by stage (default to "identified" for any null)
  const grouped = useMemo(() => {
    const map = Object.fromEntries(STAGES.map((s) => [s.key, []]));
    for (const p of prospects) {
      const k = (p.stage && map[p.stage]) ? p.stage : 'identified';
      map[k].push(p);
    }
    return map;
  }, [prospects]);

  const activeProspect = useMemo(
    () => prospects.find((p) => p.id === activeId) || null,
    [activeId, prospects]
  );

  function handleDragStart(event) {
    setActiveId(event.active.id);
  }
  function handleDragEnd(event) {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;
    const newStage = String(over.id);
    if (!STAGES.find((s) => s.key === newStage)) return;
    const p = prospects.find((x) => x.id === active.id);
    if (!p) return;
    if (p.stage === newStage) return;
    onStageChange(active.id, newStage);
  }
  function handleDragCancel() {
    setActiveId(null);
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div style={boardStyle}>
        {STAGES.map((s) => (
          <KanbanColumn
            key={s.key}
            stage={s}
            prospects={grouped[s.key]}
            onSelect={onSelect}
          />
        ))}
      </div>
      <DragOverlay dropAnimation={null}>
        {activeProspect ? <KanbanCardPresentational prospect={activeProspect} dragging /> : null}
      </DragOverlay>
    </DndContext>
  );
}

function KanbanColumn({ stage, prospects, onSelect }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.key });
  return (
    <div
      ref={setNodeRef}
      style={{
        ...columnStyle,
        background: isOver ? stage.color + '14' : 'var(--bg-elevated, #161616)',
        outline: isOver ? `2px dashed ${stage.color}` : 'none',
      }}
    >
      <div style={{ ...columnHeader, borderBottomColor: stage.color }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: stage.color, display: 'inline-block' }} />
          <span style={{ fontWeight: 600, fontSize: 12 }}>{stage.label}</span>
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{prospects.length}</span>
      </div>
      <div style={columnBody}>
        {prospects.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 11, padding: 8, textAlign: 'center' }}>—</div>
        ) : (
          prospects.map((p) => (
            <DraggableCard key={p.id} prospect={p} onSelect={onSelect} />
          ))
        )}
      </div>
    </div>
  );
}

function DraggableCard({ prospect, onSelect }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: prospect.id });
  // Hide the source card while dragging — DragOverlay shows the floating copy.
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      style={{ opacity: isDragging ? 0.35 : 1 }}
    >
      <KanbanCardPresentational
        prospect={prospect}
        dragListeners={listeners}
        onClick={() => onSelect && onSelect(prospect.id)}
      />
    </div>
  );
}

function KanbanCardPresentational({ prospect, dragListeners, onClick, dragging = false }) {
  const iccCount = (prospect.iccNetworkMatches || []).length;
  const stageColor = STAGE_COLORS[prospect.stage] || '#6b7280';
  return (
    <div
      onClick={onClick}
      style={{
        ...cardStyle,
        boxShadow: dragging ? '0 8px 24px rgba(0,0,0,0.6)' : '0 1px 2px rgba(0,0,0,0.3)',
        borderLeft: `3px solid ${stageColor}`,
        cursor: onClick ? 'pointer' : 'grabbing',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
        <span
          {...(dragListeners || {})}
          style={{
            cursor: 'grab',
            color: 'var(--text-muted)',
            marginTop: 1,
            touchAction: 'none',
          }}
          onClick={(e) => e.stopPropagation()}
          aria-label="Drag handle"
          title="Drag to move"
        >
          <GripVertical size={12} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={cardName}>{prospect.name}</div>

          <div style={cardMetaRow}>
            <span className={`tier`} style={tierPill}>Tier {prospect.tier}</span>
            {iccCount > 0 && (
              <span style={iccPill}><Zap size={10} /> {iccCount}</span>
            )}
          </div>

          {prospect.owner && (
            <div style={cardMutedRow}>👤 {prospect.owner}</div>
          )}
          {prospect.netWorth && (
            <div style={cardMutedRow}>💰 {displayNetWorthShort(prospect.netWorth)}</div>
          )}
          {(prospect.suggestedAskMin != null || prospect.suggestedAskMax != null) && (
            <div style={{ ...cardMutedRow, color: '#10b981' }}>
              🎯 {displaySuggestedAsk(prospect)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function displayNetWorthShort(v) {
  if (!v) return '';
  const lower = String(v).trim().toLowerCase();
  if (lower.includes('substantial') || lower.includes('significant')) return 'Unknown';
  if (['unknown', 'undisclosed', 'n/a', 'na', '—', '-'].includes(lower)) return 'Unknown';
  return v;
}

// ---- Inline styles ----
const boardStyle = {
  display: 'flex',
  gap: 10,
  overflowX: 'auto',
  paddingBottom: 12,
  alignItems: 'flex-start',
};
const columnStyle = {
  flex: '0 0 240px',
  minWidth: 240,
  maxWidth: 240,
  borderRadius: 8,
  border: '1px solid var(--border, #2a2a2a)',
  display: 'flex',
  flexDirection: 'column',
  maxHeight: 'calc(100vh - 260px)',
};
const columnHeader = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '8px 10px',
  borderBottom: '2px solid',
  textTransform: 'uppercase',
  letterSpacing: 0.5,
};
const columnBody = {
  padding: 8,
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  overflowY: 'auto',
  flex: 1,
};
const cardStyle = {
  background: 'var(--bg, #0e0e0e)',
  border: '1px solid var(--border, #2a2a2a)',
  borderRadius: 6,
  padding: '8px 10px',
  fontSize: 12,
};
const cardName = {
  fontWeight: 600,
  fontSize: 13,
  marginBottom: 4,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};
const cardMetaRow = {
  display: 'flex',
  gap: 6,
  alignItems: 'center',
  marginBottom: 4,
  flexWrap: 'wrap',
};
const cardMutedRow = {
  fontSize: 11,
  color: 'var(--text-muted)',
  marginTop: 2,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};
const tierPill = {
  fontSize: 10,
  padding: '1px 6px',
  borderRadius: 8,
  background: 'var(--bg-elevated, #1f1f1f)',
  color: 'var(--text-muted)',
};
const iccPill = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 3,
  fontSize: 10,
  padding: '1px 6px',
  borderRadius: 8,
  background: '#f59e0b22',
  color: '#f59e0b',
  fontWeight: 500,
};
