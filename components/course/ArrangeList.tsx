'use client';

// The drag-to-reorder list for "put these in order" questions. It lives in its own file so the
// course player can load it (and the drag-and-drop library) only when a course has one.

import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ArrowDown, ArrowUp, GripVertical } from 'lucide-react';

function SortableItem({ id, label, idx, count, accent, isDark, isChecking, onMove }: {
  id: string; label: string; idx: number; count: number; accent: string; isDark: boolean; isChecking: boolean;
  onMove: (direction: -1 | 1) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group flex items-center gap-3 px-3 py-3 rounded-xl border transition-all duration-150 ${
        isDark ? 'border-white/[0.07] bg-white/[0.035] text-[#ACB8C5]' : 'border-black/[0.06] bg-zinc-50 text-[#111111]'
      } ${isChecking ? 'pointer-events-none' : ''}`}
    >
      <span
        className="w-7 h-7 rounded-lg flex-shrink-0 flex items-center justify-center text-[11px] font-bold"
        style={{ background: `${accent}18`, color: accent }}
      >
        {idx + 1}
      </span>
      <span className="flex-1 text-sm font-medium">{label}</span>
      {!isChecking && (
        <span className="flex items-center gap-1 flex-shrink-0">
          <button type="button" onClick={() => onMove(-1)} disabled={idx === 0} aria-label={`Move ${label} up`}
            className="w-7 h-7 inline-flex items-center justify-center rounded-lg transition-colors disabled:opacity-20"
            style={{ color: isDark ? '#8b98a5' : '#71717a', background: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.035)' }}>
            <ArrowUp className="w-3.5 h-3.5" />
          </button>
          <button type="button" onClick={() => onMove(1)} disabled={idx === count - 1} aria-label={`Move ${label} down`}
            className="w-7 h-7 inline-flex items-center justify-center rounded-lg transition-colors disabled:opacity-20"
            style={{ color: isDark ? '#8b98a5' : '#71717a', background: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.035)' }}>
            <ArrowDown className="w-3.5 h-3.5" />
          </button>
          <span
            className="w-7 h-7 inline-flex items-center justify-center rounded-lg cursor-grab active:cursor-grabbing text-zinc-500 transition-colors"
            style={{ background: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.035)' }}
            aria-label={`Drag ${label} to reorder`}
            {...attributes}
            {...listeners}
          >
            <GripVertical className="w-4 h-4" />
          </span>
        </span>
      )}
    </div>
  );
}

export default function ArrangeList({ items, onChange, onMove, accent, isDark, isChecking }: {
  items: string[];
  onChange: (items: string[]) => void;
  onMove: (index: number, direction: -1 | 1) => void;
  accent: string;
  isDark: boolean;
  isChecking: boolean;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    onChange(arrayMove(items, items.indexOf(active.id as string), items.indexOf(over.id as string)));
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={items} strategy={verticalListSortingStrategy}>
        <div className="space-y-2">
          {items.map((item, idx) => (
            <SortableItem
              key={item}
              id={item}
              label={item}
              idx={idx}
              count={items.length}
              accent={accent}
              isDark={isDark}
              isChecking={isChecking}
              onMove={(direction) => onMove(idx, direction)}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
