import React, { useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { ProjectSummary, formatShortTimecode } from '../types/beatsync';

interface ProjectsModalProps {
  open: boolean;
  currentProjectId: string;
  currentTitle: string;
  projects: ProjectSummary[];
  onClose: () => void;
  onCreateNew: () => void;
  onRenameCurrent: (title: string) => void;
  onSelectProject: (id: string) => void;
  onDeleteProject: (id: string) => void;
}

export const ProjectsModal: React.FC<ProjectsModalProps> = ({
  open,
  currentProjectId,
  currentTitle,
  projects,
  onClose,
  onCreateNew,
  onRenameCurrent,
  onSelectProject,
  onDeleteProject,
}) => {
  const [titleInput, setTitleInput] = useState(currentTitle);

  React.useEffect(() => {
    setTitleInput(currentTitle);
  }, [currentTitle, open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 p-0 sm:p-4">
      <div className="flex w-full max-w-md flex-col gap-3 rounded-t-2xl sm:rounded-2xl border border-[#28332E] bg-[#121715] p-4 max-h-[85vh]">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-white">Saved Projects</h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                onCreateNew();
                onClose();
              }}
              className="flex min-h-[38px] items-center gap-1 rounded-lg bg-[#16E575] px-3 text-xs font-bold text-[#0A0D0C]"
            >
              <Plus className="h-4 w-4" />
              <span>New</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close projects"
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#28332E] text-[#9BA8A1] hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Rename current project */}
        <div className="flex gap-2">
          <input
            type="text"
            value={titleInput}
            onChange={(e) => setTitleInput(e.target.value)}
            placeholder="Project title"
            className="min-h-[42px] flex-1 rounded-lg border border-[#28332E] bg-[#0A0D0C] px-3 text-sm text-white outline-none focus:border-[#16E575]"
          />
          <button
            type="button"
            onClick={() => onRenameCurrent(titleInput)}
            className="min-h-[42px] rounded-lg bg-white px-4 text-xs font-bold text-[#0A0D0C]"
          >
            Save Name
          </button>
        </div>

        <div className="flex flex-col gap-2 overflow-y-auto pr-1">
          {projects.length === 0 ? (
            <div className="rounded-xl bg-[#0A0D0C] p-5 text-center text-xs text-[#9BA8A1]">
              Your projects auto-save locally in browser storage once media or beats are added.
            </div>
          ) : (
            projects.map((p) => {
              const active = p.id === currentProjectId;
              return (
                <div
                  key={p.id}
                  className={`flex items-center justify-between rounded-xl border px-3 py-2.5 ${
                    active
                      ? 'border-[#16E575] bg-[#132E20]'
                      : 'border-[#28332E] bg-[#1A221F]'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      onSelectProject(p.id);
                      onClose();
                    }}
                    className="flex-1 text-left min-w-0"
                  >
                    <div
                      className={`truncate text-sm font-semibold ${
                        active ? 'text-[#16E575]' : 'text-white'
                      }`}
                    >
                      {p.title}
                    </div>
                    <div className="font-mono-tnum text-[11px] text-[#9BA8A1]">
                      {p.beatCount} beats · {formatShortTimecode(p.durationMs)} · {p.estimatedBpm}{' '}
                      BPM
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteProject(p.id)}
                    aria-label={`Delete ${p.title}`}
                    className="ml-2 flex h-9 w-9 items-center justify-center rounded-lg text-[#FF5252] hover:bg-black/30"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
