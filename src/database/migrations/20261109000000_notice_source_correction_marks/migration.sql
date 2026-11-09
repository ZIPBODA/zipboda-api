-- 정정 묶음 안에서 원천마다 정정 표시 수를 알아야, 늦게 온 원 공고·정정본과 같은 날 같은 이름의 다른 공고를 가를 수 있다(ERD §5 규칙 7)
ALTER TABLE "notice_sources" ADD COLUMN "correction_marks" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "notice_sources" ADD CONSTRAINT "notice_sources_correction_marks_check" CHECK ("correction_marks" >= 0);
