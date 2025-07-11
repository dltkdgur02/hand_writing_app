import React, { useState, useRef, useEffect } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import jsPDF from 'jspdf';

pdfjsLib.GlobalWorkerOptions.workerSrc = require('pdfjs-dist/build/pdf.worker.entry');

const PdfMultiPageEditor = () => {
    const [pdfDoc, setPdfDoc] = useState(null);
    const [numPages, setNumPages] = useState(0);
    const [currentPage, setCurrentPage] = useState(1);
    const containerRef = useRef(null);
    const canvasRefs = useRef([]);
    const observerRef = useRef(null);

    const [penColor, setPenColor] = useState('#ff0000');
    const [penWidth, setPenWidth] = useState(2);
    const [eraserMode, setEraserMode] = useState('none');

    const colorRef = useRef(penColor);
    const widthRef = useRef(penWidth);
    const eraserRef = useRef(eraserMode);
    const strokesRef = useRef({});
    const undoStackRef = useRef({});
    const redoStackRef = useRef({});

    useEffect(() => { colorRef.current = penColor }, [penColor]);
    useEffect(() => { widthRef.current = penWidth }, [penWidth]);
    useEffect(() => { eraserRef.current = eraserMode }, [eraserMode]);

    const handleFileChange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const url = URL.createObjectURL(file);

        const loadingTask = pdfjsLib.getDocument(url);
        const loadedPdf = await loadingTask.promise;
        setPdfDoc(loadedPdf);
        setNumPages(loadedPdf.numPages);
        setCurrentPage(1);
    };

    useEffect(() => {
        if (!pdfDoc || numPages === 0) return;

        const renderPages = async () => {
            canvasRefs.current = [];
            strokesRef.current = {};
            containerRef.current.innerHTML = '';

            for (let i = 1; i <= numPages; i++) {
                const page = await pdfDoc.getPage(i);
                const scale = 1.5;
                const viewport = page.getViewport({ scale });

                const pdfCanvas = document.createElement('canvas');
                const pdfCtx = pdfCanvas.getContext('2d');
                pdfCanvas.width = viewport.width;
                pdfCanvas.height = viewport.height;
                await page.render({ canvasContext: pdfCtx, viewport }).promise;

                const drawCanvas = document.createElement('canvas');
                drawCanvas.width = viewport.width;
                drawCanvas.height = viewport.height;
                drawCanvas.style.position = 'absolute';
                drawCanvas.style.left = '0';
                drawCanvas.style.top = '0';
                drawCanvas.style.touchAction = 'auto';

                bindDrawing(drawCanvas, i);

                const wrapper = document.createElement('div');
                wrapper.className = `pdf-page page-${i}`;
                wrapper.style.display = 'flex';
                wrapper.style.flexDirection = 'column';
                wrapper.style.scrollSnapAlign = 'start';
                wrapper.style.flexShrink = '0';
                wrapper.style.minWidth = `${viewport.width}px`;
                wrapper.style.maxWidth = `${viewport.width}px`;
                wrapper.style.height = `${viewport.height}px`;
                wrapper.style.marginRight = '10px';
                wrapper.style.position = 'relative';

                wrapper.appendChild(pdfCanvas);
                wrapper.appendChild(drawCanvas);

                containerRef.current.appendChild(wrapper);
                canvasRefs.current.push({ pdfCanvas, drawCanvas });
            }
        };

        renderPages();
    }, [pdfDoc, numPages]);

    useEffect(() => {
        const container = containerRef.current;
        if (!container || numPages === 0) return;

        const observer = new IntersectionObserver((entries) => {
            const visibleEntries = entries
                .filter(entry => entry.isIntersecting)
                .sort((a, b) => b.intersectionRatio - a.intersectionRatio);

            if (visibleEntries.length > 0) {
                const match = visibleEntries[0].target.className.match(/page-(\d+)/);
                if (match) {
                    const pageNum = parseInt(match[1]);
                    if (pageNum !== currentPage) {
                        setCurrentPage(pageNum);
                    }
                }
            }
        }, {
            root: container,
            threshold: 0.6, // 60% 이상 보이면 해당 페이지로 인식
        });

        const targets = container.querySelectorAll('.pdf-page');
        targets.forEach(target => observer.observe(target));

        observerRef.current = observer;

        return () => observer.disconnect();
    }, [pdfDoc, numPages]);

    useEffect(() => {
        const container = containerRef.current;
        if (!container || numPages === 0) return;

        const handleScroll = () => {
            const children = Array.from(container.children);
            const containerRect = container.getBoundingClientRect();
            const centerX = containerRect.left + containerRect.width / 2;

            let closestPage = 1;
            let minDistance = Infinity;

            children.forEach((child, index) => {
                const rect = child.getBoundingClientRect();
                const pageCenter = rect.left + rect.width / 2;
                const distance = Math.abs(centerX - pageCenter);

                if (distance < minDistance) {
                    minDistance = distance;
                    closestPage = index + 1;
                }
            });

            if (closestPage !== currentPage) {
                setCurrentPage(closestPage);
            }
        };

        container.addEventListener('scroll', handleScroll);
        return () => container.removeEventListener('scroll', handleScroll);
    }, [currentPage, numPages]);

    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.ctrlKey && e.key === 'z') {
                e.preventDefault();
                undo();
            } else if (e.ctrlKey && e.key === 'y') {
                e.preventDefault();
                redo();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [currentPage]);


    const bindDrawing = (canvas, pageNum) => {
        const ctx = canvas.getContext('2d');
        ctx.lineCap = 'round';
        let drawing = false;
        let currentStroke = [];

        const start = (x, y) => {
            const mode = eraserRef.current;

            // 획 지우기 모드
            if (mode === 'stroke') {
                eraseStroke(x, y, pageNum, ctx, canvas);
                return;
            }

            ctx.beginPath();

            // 형광펜 모드
            if (mode === 'highlight') {
                ctx.globalCompositeOperation = 'multiply'; // ✨ 핵심 변경: multiply 모드로 설정
                ctx.globalAlpha = 0.6;                      // ✨ 적절한 투명도
                ctx.strokeStyle = 'rgba(255, 255, 0, 1)';   // ✨ 불투명 노란색
                ctx.lineWidth = 20;
            }
            // 픽셀 지우개 모드
            else if (mode === 'pixel') {
                ctx.globalCompositeOperation = 'destination-out';
                ctx.globalAlpha = 1.0;
                ctx.strokeStyle = 'rgba(0, 0, 0, 1)';
                ctx.lineWidth = widthRef.current;
            }
            // 일반 펜 모드
            else {
                ctx.globalCompositeOperation = 'source-over';
                ctx.globalAlpha = 1.0;
                ctx.strokeStyle = colorRef.current;
                ctx.lineWidth = widthRef.current;
            }

            ctx.moveTo(x, y);
            drawing = true;

            if (mode === 'none' || mode === 'highlight') {
                currentStroke = [{ x, y }];
            }
        };

        const move = (x, y) => {
            if (!drawing) return;
            ctx.lineTo(x, y);
            ctx.stroke();

            const mode = eraserRef.current;
            if (mode === 'none' || mode === 'highlight') {
                currentStroke.push({ x, y });
            }
        };

        const end = () => {
            const mode = eraserRef.current;
            if (drawing && (mode === 'none' || mode === 'highlight')) {
                const stroke = {
                    points: currentStroke,
                    color: mode === 'highlight' ? 'rgba(255, 255, 0, 0.3)' : colorRef.current,
                    width: mode === 'highlight' ? 20 : widthRef.current,
                    mode: mode === 'highlight' ? 'highlight' : 'normal',
                };

                if (!strokesRef.current[pageNum]) strokesRef.current[pageNum] = [];
                strokesRef.current[pageNum].push(stroke);

                if (!undoStackRef.current[pageNum]) undoStackRef.current[pageNum] = [];
                if (!redoStackRef.current[pageNum]) redoStackRef.current[pageNum] = [];
                undoStackRef.current[pageNum].push(stroke);
                redoStackRef.current[pageNum] = [];
            }

            drawing = false;
            ctx.closePath();
        };

        // 마우스 이벤트
        canvas.onmousedown = (e) => start(e.offsetX, e.offsetY);
        canvas.onmousemove = (e) => move(e.offsetX, e.offsetY);
        canvas.onmouseup = end;
        canvas.onmouseleave = end;

        // 터치 이벤트
        canvas.ontouchstart = (e) => {
            const touch = e.touches[0];
            if ('touchType' in touch && touch.touchType !== 'stylus') return;
            e.preventDefault();
            const rect = canvas.getBoundingClientRect();
            start(touch.clientX - rect.left, touch.clientY - rect.top);
        };
        canvas.ontouchmove = (e) => {
            const touch = e.touches[0];
            if ('touchType' in touch && touch.touchType !== 'stylus') return;
            e.preventDefault();
            const rect = canvas.getBoundingClientRect();
            move(touch.clientX - rect.left, touch.clientY - rect.top);
        };
        canvas.ontouchend = end;
    };
;


    const eraseStroke = (x, y, pageNum, ctx, canvas) => {
        const strokes = strokesRef.current[pageNum] || [];
        const threshold = 10;
        let removed = false;

        for (let i = 0; i < strokes.length; i++) {
            const stroke = strokes[i];
            for (const pt of stroke.points) {
                const dist = Math.hypot(pt.x - x, pt.y - y);
                if (dist < threshold) {
                    strokes.splice(i, 1);
                    removed = true;
                    break;
                }
            }
            if (removed) break;
        }

        if (removed) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            for (const stroke of strokes) {
                ctx.beginPath();
                ctx.strokeStyle = stroke.color;
                ctx.lineWidth = stroke.width;
                ctx.lineCap = 'round';
                const [start, ...rest] = stroke.points;
                ctx.moveTo(start.x, start.y);
                for (const pt of rest) ctx.lineTo(pt.x, pt.y);
                ctx.stroke();
                ctx.closePath();
            }
        }
    };

    const undo = () => {
        const page = currentPage;
        const undoStack = undoStackRef.current[page] || [];
        const redoStack = redoStackRef.current[page] || [];

        if (undoStack.length === 0) return;

        const last = undoStack.pop();
        redoStack.push(last);
        strokesRef.current[page].pop();
        redraw(page);
    };

    const redo = () => {
        const page = currentPage;
        const undoStack = undoStackRef.current[page] || [];
        const redoStack = redoStackRef.current[page] || [];

        if (redoStack.length === 0) return;

        const restored = redoStack.pop();
        undoStack.push(restored);
        strokesRef.current[page].push(restored);
        redraw(page);
    };

    const redraw = (pageNum) => {
        const { drawCanvas } = canvasRefs.current[pageNum - 1];
        const ctx = drawCanvas.getContext('2d');
        ctx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
        const strokes = strokesRef.current[pageNum] || [];

        for (const stroke of strokes) {
            ctx.beginPath();
            ctx.strokeStyle = stroke.color;
            ctx.lineWidth = stroke.width;
            ctx.lineCap = 'round';
            ctx.globalCompositeOperation = stroke.mode === 'highlight' ? 'multiply' : 'source-over';
            const [start, ...rest] = stroke.points;
            ctx.moveTo(start.x, start.y);
            for (const pt of rest) ctx.lineTo(pt.x, pt.y);
            ctx.stroke();
            ctx.closePath();
        }
    };


    const exportToPDF = () => {
        const pdf = new jsPDF();
        canvasRefs.current.forEach(({ pdfCanvas, drawCanvas }, index) => {
            const mergedCanvas = document.createElement('canvas');
            mergedCanvas.width = pdfCanvas.width;
            mergedCanvas.height = pdfCanvas.height;
            const ctx = mergedCanvas.getContext('2d');
            ctx.drawImage(pdfCanvas, 0, 0);
            ctx.drawImage(drawCanvas, 0, 0);

            const imgData = mergedCanvas.toDataURL('image/png');
            if (index > 0) pdf.addPage();
            const pageWidth = pdf.internal.pageSize.getWidth();
            const pageHeight = pdf.internal.pageSize.getHeight();
            pdf.addImage(imgData, 'PNG', 0, 0, pageWidth, pageHeight);
        });

        pdf.save('annotated.pdf');
    };

    return (
        <div style={{ textAlign: 'center' }}>
            <h3>📝 PDF 필기 앱 </h3>
            <input type="file" accept="application/pdf" onChange={handleFileChange} />

            {pdfDoc && (
                <>
                    <div style={{ margin: '15px' }}>
                        <label>🖍️ 색상: </label>
                        <input type="color" value={penColor} onChange={(e) => setPenColor(e.target.value)} disabled={eraserMode !== 'none'} />
                        <label style={{ marginLeft: '20px' }}>굵기: {penWidth}px</label>
                        <input type="range" min="1" max="20" value={penWidth} onChange={(e) => setPenWidth(parseInt(e.target.value))} style={{ marginLeft: '10px' }} />
                        <label style={{ marginLeft: '20px' }}>모드: </label>
                        <select value={eraserMode} onChange={(e) => setEraserMode(e.target.value)} style={{ marginLeft: '10px' }}>
                            <option value="none">펜</option>
                            <option value="pixel">픽셀 지우개</option>
                            <option value="stroke">획 지우기</option>
                            <option value="highlight">형광펜</option>
                        </select>
                        <div style={{ marginTop: '10px', fontWeight: 'bold' }}>
                            📄 현재 페이지: {currentPage} / {numPages}
                        </div>
                    </div>

                    <div
                        ref={containerRef}
                        style={{
                            display: 'flex',
                            flexDirection: 'row',
                            overflowX: 'auto',
                            overflowY: 'hidden',
                            scrollSnapType: 'x mandatory',
                            scrollBehavior: 'smooth',
                            width: '100%',
                            height: 'auto',
                            border: '1px solid #ccc',
                        }}
                    ></div>

                    <button style={{ marginTop: '20px' }} onClick={exportToPDF}>
                        📥 필기 포함 PDF 저장
                    </button>
                    <button onClick={undo}>↩️ Undo</button>
                    <button onClick={redo} style={{ marginLeft: '10px' }}>↪️ Redo</button>
                </>
            )}
        </div>
    );
};

export default PdfMultiPageEditor;
